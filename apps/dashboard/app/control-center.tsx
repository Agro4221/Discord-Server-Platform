"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AnalyticsPanel } from "./analytics-panel";
import { HelpPagesPanel } from "./help-pages-panel";
import { AutoModRulesPanel } from "./automod-rules-panel";
import { AutomationPanel } from "./automation-panel";
import { BackupPanel } from "./backup-panel";
import { CommandPolicyPanel } from "./command-policy-panel";
import { CustomCommandsPanel } from "./custom-commands-panel";
import { AutoResponderPanel } from "./autoresponder-panel";
import { FleetPanel } from "./fleet-panel";
import { EmbedBuilderPanel } from "./embed-builder-panel";
import { GiveawaysPanel } from "./giveaways-panel";
import { ModerationPanel } from "./moderation-panel";
import { NotificationsPanel } from "./notifications-panel";
import { StreamAlertsPanel } from "./stream-alerts-panel";
import { TicketFormPanel } from "./ticket-form-panel";
import { RolePanelsEditor } from "./role-panels-editor";
import { FormsPanel } from "./forms-panel";
import { OnboardingPanel } from "./onboarding-panel";
import { LevelingRewardsPanel } from "./leveling-rewards-panel";
import { CommunityHubPanel } from "./community-hub-panel";
import { ModuleActivityPanel } from "./module-activity-panel";
import { ConfigPresetsPanel } from "./config-presets-panel";

type View = "overview" | "category" | "module" | "functions" | "system" | "audit";
type Guild = { id: string; name: string; icon: string | null; memberCount?: number; channelCount?: number; roleCount?: number };
type ModuleState = Record<string, boolean>;
type SettingType = "text" | "number" | "boolean" | "channel" | "role" | "textarea";
type Field = {
  key: string;
  label: string;
  type: SettingType;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
};
type ModuleAction = { id: string; label: string; kind?: "safe" | "danger"; confirmation?: string };
type Schema = { key: string; title: string; fields: Field[]; actions?: ModuleAction[] };
type Resource = { id: string; name: string; type?: number; position?: number; manageable?: boolean };
type AuditEvent = {
  id?: string;
  action: string;
  source?: "discord" | "dashboard" | "system";
  actor_user_id?: string | null;
  target_type?: string | null;
  target_id: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
};
type CatalogItem = { key: string; title: string; description: string };
type Health = { status: string; discord: string; database: string } | null;

type Category = {
  key: "moderation" | "server" | "community" | "automation" | "integrations" | "system";
  label: string;
  eyebrow: string;
  icon: string;
  summary: string;
};

type ModuleMeta = {
  icon: string;
  accent: string;
  title: string;
  summary: string;
  category: Category["key"];
  commands: string[];
  functions: Array<{ title: string; description: string }>;
  kind: "settings" | "full" | "discord";
};

const CATEGORIES: Category[] = [
  {
    key: "moderation",
    label: "Модерация и безопасность",
    eyebrow: "MODERATION & SECURITY",
    icon: "◈",
    summary: "Контроль участников, AutoMod, Anti-Raid и защитные реакции."
  },
  {
    key: "server",
    label: "Сервер",
    eyebrow: "SERVER",
    icon: "⚙",
    summary: "Каналы, роли, onboarding, тикеты и временные голосовые комнаты."
  },
  {
    key: "community",
    label: "Сообщество",
    eyebrow: "COMMUNITY",
    icon: "✦",
    summary: "Уровни, розыгрыши, экономика, напоминания и Starboard."
  },
  {
    key: "automation",
    label: "Автоматизация",
    eyebrow: "AUTOMATION",
    icon: "↯",
    summary: "Сценарии по событиям: условия, действия, cooldown и аудит."
  },
  {
    key: "integrations",
    label: "Интеграции и медиа",
    eyebrow: "INTEGRATIONS & MEDIA",
    icon: "◌",
    summary: "Ленты, музыка/Lavalink и аналитика активности."
  },
  {
    key: "system",
    label: "Система",
    eyebrow: "SYSTEM",
    icon: "▣",
    summary: "Состояние Core, fleet, резервные копии, импорт/экспорт и аудит."
  }
];

const MODULE_META: Record<string, ModuleMeta> = {
  moderation: {
    icon: "⚖",
    accent: "#f0a46b",
    title: "Модерация",
    summary: "Предупреждения, timeout, kick, ban, unban и история кейсов.",
    category: "moderation",
    commands: ["/moderate warn", "/moderate timeout", "/moderate kick", "/moderate ban", "/moderate unban", "/moderate history"],
    functions: [
      { title: "Предупреждения", description: "Создание warn-кейсов с причиной и сохранением истории." },
      { title: "Timeout", description: "Временное ограничение участника с контролем длительности." },
      { title: "Kick / Ban / Unban", description: "Модерационные действия с проверкой прав и иерархии." },
      { title: "История", description: "Просмотр последних moderation cases по пользователю." }
    ],
    kind: "discord"
  },
  automod: {
    icon: "⌁",
    accent: "#f0c46b",
    title: "AutoMod",
    summary: "Контент-фильтры и защита от спама.",
    category: "moderation",
    commands: ["/automod setup"],
    functions: [
      { title: "Запрещённые слова", description: "Фильтрация слов без сохранения текста нарушающего сообщения." },
      { title: "Антиспам", description: "Упоминания, повторные сообщения, CAPS и лимиты содержимого." },
      { title: "Ссылки и инвайты", description: "Отдельные ограничения для ссылок и Discord invites." },
      { title: "Исключения", description: "Исключение отдельных каналов и ролей." },
      { title: "Реакция", description: "Удаление сообщения и опциональный timeout." }
    ],
    kind: "settings"
  },
  security: {
    icon: "◉",
    accent: "#ef7777",
    title: "Security",
    summary: "Anti-Raid и защита от разрушительных всплесков.",
    category: "moderation",
    commands: ["/security setup"],
    functions: [
      { title: "Anti-Raid", description: "Порог входов за заданное окно времени." },
      { title: "Destructive burst", description: "Ловит резкие всплески потенциально разрушительных действий." },
      { title: "Quarantine", description: "Поддержка quarantine-роли как защитного контура." },
      { title: "Hierarchy check", description: "Диагностика и проверка роли бота перед защитными действиями." }
    ],
    kind: "settings"
  },
  "temporary-voice": {
    icon: "◌",
    accent: "#76b7f4",
    title: "Temporary Voice",
    summary: "Комнаты, создаваемые при входе в voice-триггер.",
    category: "server",
    commands: ["/setup temp-voice"],
    functions: [
      { title: "Create-on-join", description: "Создание временной комнаты при входе в триггер-канал." },
      { title: "Лимит участников", description: "Задание лимита комнаты по умолчанию." },
      { title: "Приватность", description: "Создание приватных комнат по умолчанию." },
      { title: "Категория", description: "Размещение создаваемых комнат в выбранной категории." },
      { title: "Recovery", description: "Reconciliation после рестарта и очистка освобождённых комнат." }
    ],
    kind: "settings"
  },
  welcome: {
    icon: "✧",
    accent: "#9ccf87",
    title: "Welcome",
    summary: "Приветствия, goodbye и отправка сообщений.",
    category: "server",
    commands: ["/welcome setup"],
    functions: [
      { title: "Welcome message", description: "Сообщение при входе нового участника." },
      { title: "DM", description: "Опциональная копия приветствия в личные сообщения." },
      { title: "Embeds", description: "Переключение embed-оформления сообщения." }
    ],
    kind: "settings"
  },
  verification: {
    icon: "✓",
    accent: "#70d4b5",
    title: "Verification",
    summary: "Проверка участников и роли quarantine/verified.",
    category: "server",
    commands: ["/verify setup", "/verify panel"],
    functions: [
      { title: "Verification flow", description: "Настройка канала и срока действия кода." },
      { title: "Verified / Quarantine roles", description: "Роли до и после успешной проверки." },
      { title: "Verification panel", description: "Публикация пользовательского verification-панели." },
      { title: "Логи", description: "Отдельный канал для событий verification." }
    ],
    kind: "settings"
  },
  onboarding: {
    icon: "◎",
    accent: "#82d4b3",
    title: "Onboarding",
    summary: "Сценарий действий при входе или после успешной Verification.",
    category: "server",
    commands: ["Dashboard"],
    functions: [
      { title: "Flow trigger", description: "Запуск при входе участника или после успешной Verification." },
      { title: "Role steps", description: "Последовательная выдача стартовых ролей с проверкой hierarchy." },
      { title: "Channel messages", description: "Публикация персонализированных сообщений в выбранные каналы." },
      { title: "Direct messages", description: "Отправка персонализированных сообщений участнику в ЛС." },
      { title: "Step ordering", description: "До 10 шагов с явным порядком выполнения." }
    ],
    kind: "full"
  },
  forms: {
    icon: "▱",
    accent: "#82c7f1",
    title: "Forms",
    summary: "Универсальные серверные формы на Discord Modal с публикацией и сбором ответов.",
    category: "server",
    commands: ["/form publish"],
    functions: [
      { title: "Form builder", description: "До 5 настраиваемых полей short/paragraph с required и min/max length." },
      { title: "Publishing", description: "Публикация кнопки запуска формы в выбранный текстовый канал." },
      { title: "Response delivery", description: "Сохранение ответов и отправка staff-уведомления в выбранный канал." },
      { title: "Persistent config", description: "Определения форм хранятся в PostgreSQL и входят в конфигурационный export/import." }
    ],
    kind: "full"
  },
  roles: {
    icon: "♢",
    accent: "#b294f6",
    title: "Роли",
    summary: "Role Panels, CRUD и публикация self-service ролей.",
    category: "server",
    commands: ["/roles panel"],
    functions: [
      { title: "Role Panels", description: "Создание и редактирование панелей самостоятельного выбора ролей." },
      { title: "Publishing", description: "Публикация панели в выбранный текстовый канал." },
      { title: "Hierarchy checks", description: "Защита от назначения ролей выше роли бота." }
    ],
    kind: "full"
  },
  tickets: {
    icon: "▤",
    accent: "#d3a4f0",
    title: "Тикеты",
    summary: "Поддержка, staff workflow и настраиваемая intake-форма.",
    category: "server",
    commands: ["/ticket create", "/ticket setup"],
    functions: [
      { title: "Intake form", description: "До 5 полей Discord Modal: short/paragraph, required, placeholder и лимит длины." },
      { title: "Persistent answers", description: "Ответы формы сохраняются вместе с тикетом и попадают в transcript." },
      { title: "Staff workflow", description: "Claim, close/reopen, category routing и ограничения на открытые тикеты." },
      { title: "Ticket Panels", description: "Несколько независимых точек входа в одну Ticket-систему с отдельным каналом и оформлением." },
      { title: "Transcripts", description: "HTML transcript сохраняется и может быть опубликован в transcript channel." }
    ],
    kind: "full"
  },
  leveling: {
    icon: "↗",
    accent: "#72c5f2",
    title: "Leveling",
    summary: "XP, уровни, rank и leaderboard.",
    category: "community",
    commands: ["/leveling setup", "/leveling rank", "/leveling top"],
    functions: [
      { title: "XP", description: "Начисление опыта за сообщения." },
      { title: "Cooldown", description: "Ограничение частоты начисления XP." },
      { title: "Rank", description: "Просмотр собственного или чужого ранга." },
      { title: "Leaderboard", description: "Таблица лидеров сервера." },
      { title: "Custom rewards", description: "Награды за уровни: роли, снятие предыдущих наград, DM и milestone-сообщение." }
    ],
    kind: "full"
  },
  giveaways: {
    icon: "🎁",
    accent: "#f09bc0",
    title: "Розыгрыши",
    summary: "Создание, завершение, reroll и история кампаний.",
    category: "community",
    commands: ["/giveaway create", "/giveaway end", "/giveaway reroll"],
    functions: [
      { title: "Create", description: "Запуск розыгрыша с длительностью, призом и количеством победителей." },
      { title: "Lifecycle", description: "Защита от гонок при завершении и поздних входах." },
      { title: "Reroll", description: "Повторный выбор победителей завершённого розыгрыша." },
      { title: "Dashboard history", description: "История и операционные действия без ручного поиска сообщений." }
    ],
    kind: "full"
  },
  starboard: {
    icon: "★",
    accent: "#e5c76b",
    title: "Starboard",
    summary: "Публикация популярных сообщений в отдельный канал.",
    category: "community",
    commands: ["/starboard setup"],
    functions: [
      { title: "Threshold", description: "Количество реакций до публикации." },
      { title: "Filtering", description: "Игнорирование собственных реакций и ботов." },
      { title: "Publishing", description: "Безопасная публикация с rollback при ошибке БД." }
    ],
    kind: "settings"
  },
  economy: {
    icon: "◍",
    accent: "#7bd6a3",
    title: "Экономика",
    summary: "Баланс, daily, pay, leaderboard и магазин.",
    category: "community",
    commands: ["/economy balance", "/economy daily", "/economy pay", "/economy leaderboard", "/shop list", "/shop buy", "/shop create"],
    functions: [
      { title: "Баланс", description: "Проверка баланса пользователя." },
      { title: "Daily / Pay", description: "Ежедневная награда и переводы между участниками." },
      { title: "Leaderboard", description: "Таблица самых богатых участников." },
      { title: "Shop", description: "Магазин с ролями, ценой и ограниченным stock." }
    ],
    kind: "discord"
  },
  reminders: {
    icon: "◷",
    accent: "#85b8dd",
    title: "Напоминания",
    summary: "Напоминания и utility-функции.",
    category: "community",
    commands: ["/remind", "/schedule", "/sticky setup", "/sticky remove", "/sticky list"],
    functions: [
      { title: "Reminders", description: "Отложенное напоминание с повторяемой обработкой фонового worker." },
      { title: "Retry / lease", description: "Фоновая доставка использует lease/retry semantics." },
      { title: "Scheduled messages", description: "Одноразовая публикация в выбранный текстовый канал по таймеру через тот же worker." },
      { title: "Sticky messages", description: "Постоянное сообщение в канале, которое автоматически возвращается вниз после новых сообщений." }
    ],
    kind: "discord"
  },
  automation: {
    icon: "↯",
    accent: "#9f8cf2",
    title: "Automation",
    summary: "Event → conditions → actions с cooldown.",
    category: "automation",
    commands: ["/automation create"],
    functions: [
      { title: "Events", description: "Join, leave, message и voice события." },
      { title: "Conditions", description: "Фильтры по полям события и безопасная проверка импорта." },
      { title: "Actions", description: "Сообщения, роли, модерационные и служебные действия." },
      { title: "Cooldown", description: "Защита от повторного запуска правила." },
      { title: "Audit", description: "Изменения правил пишутся в durable audit log." }
    ],
    kind: "full"
  },
  notifications: {
    icon: "◬",
    accent: "#74c8dc",
    title: "Уведомления",
    summary: "RSS/Atom feeds с безопасной сетевой проверкой.",
    category: "integrations",
    commands: ["/feed add", "/feed github"],
    functions: [
      { title: "RSS / Atom", description: "Периодический polling внешнего HTTPS feed." },
      { title: "SSRF protection", description: "Блокировка private, mapped и loopback адресов для внешних feed URL." },
      { title: "Cursor safety", description: "Курсор обновляется только после успешной доставки feed-сообщения." }
    ],
    kind: "full"
  },
  "stream-alerts": {
    icon: "◉",
    accent: "#ef7272",
    title: "Stream Alerts",
    summary: "Уведомления о начале прямых эфиров.",
    category: "integrations",
    commands: ["/streamalert create"],
    functions: [
      { title: "Platforms", description: "Twitch, YouTube, VK Видео Live и Kick." },
      { title: "Templates", description: "Шаблоны сообщения с mention, названием эфира, автором и URL." },
      { title: "Persistent state", description: "Состояние подписок и последний обнаруженный эфир хранятся в PostgreSQL." },
      { title: "Provider status", description: "Dashboard показывает, какие API credentials настроены." }
    ],
    kind: "full"
  },
  music: {
    icon: "♫",
    accent: "#8bb8f0",
    title: "Music",
    summary: "Lavalink, очередь, repeat, autoplay и per-voice routing.",
    category: "integrations",
    commands: ["/music play", "/music pause", "/music resume", "/music skip", "/music stop", "/music shuffle", "/music repeat", "/music autoplay", "/music seek", "/music queue", "/music nowplaying", "/music volume"],
    functions: [
      { title: "Playback", description: "Play, pause, resume, skip, stop и seek." },
      { title: "Queue", description: "Очередь, shuffle и повтор трека/очереди, теперь с постраничным просмотром." },
      { title: "Saved state", description: "Личные favorites и сохранённые playlists до 500 треков." },
      { title: "Filters", description: "Bassboost, Rock, Pop, Electronic, Gaming, Nightcore и 8D." },
      { title: "Autoplay", description: "Автоматическое продолжение после окончания очереди." },
      { title: "Request channel", description: "Можно писать песню, исполнителя, URL или плейлист прямо в выделенный текстовый канал." },
      { title: "Controller", description: "Постоянный panel с pause, skip, shuffle, repeat, stop, volume и queue." },
      { title: "Voice access", description: "Управление привязано к voice-каналу или Manage Server." },
      { title: "Lavalink health", description: "Статус модуля зависит от доступности узлов." },
      { title: "Multi-bot routing", description: "Отдельные bot identities могут обслуживать разные voice-каналы." }
    ],
    kind: "settings"
  },
  reputation: {
    icon: "★",
    accent: "#d7ba73",
    title: "Репутация",
    summary: "Rep и социальные профили участников.",
    category: "community",
    commands: ["/rep give", "/rep check", "/rep leaderboard", "/profile"],
    functions: [
      { title: "Rep", description: "Участники выдают друг другу +1 rep с защитой от повторной выдачи в течение дня." },
      { title: "Leaderboard", description: "Топ участников по репутации сервера." },
      { title: "Profiles", description: "Публичное био и текущая репутация участника." }
    ],
    kind: "discord"
  },
  polls: {
    icon: "◉",
    accent: "#79c7dd",
    title: "Опросы и предложения",
    summary: "Интерактивные голосования и community suggestions прямо в Discord.",
    category: "community",
    commands: ["/poll create", "/poll close", "/suggestion create", "/suggestion review"],
    functions: [
      { title: "Live voting", description: "Голоса пересчитываются прямо на опубликованном сообщении." },
      { title: "Multiple choice", description: "Один вариант или несколько вариантов на участника." },
      { title: "Auto-close", description: "Опрос закрывается автоматически по заданному дедлайну." },
      { title: "Persistent state", description: "Вопросы, голоса и предложения сохраняются в PostgreSQL." },
      { title: "Suggestions", description: "Предложения собирают голоса За/Против и могут быть приняты или отклонены staff." }
    ],
    kind: "discord"
  },
  "custom-commands": {
    icon: "⌘",
    accent: "#82b8f2",
    title: "Custom Commands",
    summary: "Пользовательские Prefix/Slash-команды, aliases и role actions.",
    category: "automation",
    commands: ["Prefix + Slash"],
    functions: [
      { title: "Response", description: "Текстовые ответы с переменными user, mention, server, channel и args." },
      { title: "Aliases", description: "Короткие имена для существующих команд." },
      { title: "Role actions", description: "Выдача, снятие и toggle ролей с учётом hierarchy." },
      { title: "Cooldown", description: "Ограничение частоты выполнения пользовательской команды." }
    ],
    kind: "full"
  },
  autoresponder: {
    icon: "↻",
    accent: "#79c7dd",
    title: "AutoResponder",
    summary: "Автоматические ответы на ключевые слова и фразы.",
    category: "automation",
    commands: ["Dashboard"],
    functions: [
      { title: "Triggers", description: "Точные, частичные, prefix и regex-сопоставления." },
      { title: "Scopes", description: "Ограничения по ролям и каналам." },
      { title: "Cooldown", description: "Per-user cooldown для защиты от зацикливания и спама." },
      { title: "Templates", description: "Переменные user, mention, server и channel." }
    ],
    kind: "full"
  },
  analytics: {
    icon: "▥",
    accent: "#7cc9b8",
    title: "Analytics",
    summary: "Активность сервера и события за выбранный период.",
    category: "integrations",
    commands: ["/analytics"],
    functions: [
      { title: "Activity report", description: "Сводка активности по minute buckets." },
      { title: "Time windows", description: "Отчёты с контролируемым временным диапазоном." }
    ],
    kind: "full"
  }
};

const PANEL_KEYS = new Set(["moderation", "custom-commands", "autoresponder", "automod", "tickets", "embed", "roles", "forms", "onboarding", "giveaways", "analytics", "automation", "notifications", "stream-alerts"]);

const secondaryButtonStyle = {
  border: "1px solid #303846",
  background: "#0f131a",
  color: "#b6c0ce",
  borderRadius: 10,
  padding: "10px 12px",
  cursor: "pointer"
} as const;

const panel = {
  background: "linear-gradient(180deg,#131720 0%,#0e1117 100%)",
  border: "1px solid #252c38",
  borderRadius: 18,
  boxShadow: "0 16px 46px rgba(0,0,0,.17)"
} as const;

const inputStyle = {
  background: "#0c1016",
  color: "#f4f6fa",
  border: "1px solid #303846",
  borderRadius: 11,
  padding: "11px 12px",
  outline: "none"
} as const;

const selectStyle = {
  ...inputStyle,
  padding: "9px 10px"
} as const;

export function ControlCenter() {
  const [view, setView] = useState<View>("overview");
  const [category, setCategory] = useState<Category["key"]>("moderation");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [modules, setModules] = useState<ModuleState>({});
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [resources, setResources] = useState<{ channels: Resource[]; roles: Resource[] }>({ channels: [], roles: [] });
  const [selectedModule, setSelectedModule] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<Health>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditSource, setAuditSource] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditActor, setAuditActor] = useState("");
  const [auditNextBefore, setAuditNextBefore] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [search, setSearch] = useState("");
  const [functionsOnly, setFunctionsOnly] = useState(false);

  const selectedGuild = guilds.find((guild) => guild.id === guildId);
  const selectedSchema = useMemo(
    () => schemas.find((item) => item.key === selectedModule) ?? null,
    [schemas, selectedModule]
  );
  const selectedCatalog = useMemo(
    () => catalog.find((item) => item.key === selectedModule),
    [catalog, selectedModule]
  );
  const enabledModules = catalog.filter((item) => modules[item.key]);
  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return catalog.filter((item) => {
      const meta = MODULE_META[item.key];
      if (!meta) return true;
      if (category !== meta.category) return false;
      if (!query) return true;
      const haystack = [
        meta.title,
        meta.summary,
        item.title,
        item.description,
        ...meta.commands,
        ...meta.functions.flatMap((entry) => [entry.title, entry.description])
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });
  }, [catalog, category, search]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/guilds", { cache: "no-store" }).then(async (response) => response.json()),
      fetch("/api/module-schemas", { cache: "no-store" }).then(async (response) => response.json()),
      fetch("/api/health", { cache: "no-store" }).then(async (response) => response.json()).catch(() => null)
    ])
      .then(([guildResponse, schemaResponse, healthResponse]) => {
        const nextGuilds = (guildResponse.guilds ?? []) as Guild[];
        setGuilds(nextGuilds);
        setGuildId((current) => current || nextGuilds[0]?.id || "");
        setSchemas((schemaResponse.schemas ?? []) as Schema[]);
        setHealth(healthResponse);
      })
      .catch(() => setError("Не удалось загрузить Control Center."));
  }, []);

  useEffect(() => {
    if (!guildId) return;
    let cancelled = false;

    async function getJson(path: string, label: string): Promise<Record<string, unknown>> {
      const response = await fetch(path, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? label));
      return body as Record<string, unknown>;
    }

    async function loadGuildData() {
      let moduleResponse: Record<string, unknown> | undefined;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          moduleResponse = await getJson(
            "/api/guilds/" + encodeURIComponent(guildId) + "/modules",
            "modules_failed"
          );
          break;
        } catch (reason) {
          const code = reason instanceof Error ? reason.message : "modules_failed";
          if (attempt < 6 && code === "guild_not_found") {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          throw reason;
        }
      }

      const [resourceResponse, auditResponse] = await Promise.all([
        getJson("/api/guilds/" + encodeURIComponent(guildId) + "/resources", "resources_failed"),
        getJson("/api/guilds/" + encodeURIComponent(guildId) + "/audit?limit=60", "audit_failed")
      ]);

      if (cancelled) return;
      const nextCatalog = (moduleResponse?.catalog ?? []) as CatalogItem[];
      setCatalog(nextCatalog);
      setModules((moduleResponse?.modules ?? {}) as ModuleState);
      setResources({
        channels: (resourceResponse.channels ?? []) as Resource[],
        roles: (resourceResponse.roles ?? []) as Resource[]
      });
      setAudit((auditResponse.events ?? []) as AuditEvent[]);
      setSelectedModule((current) => current || nextCatalog[0]?.key || "");
    }

    void loadGuildData().catch((reason) => {
      if (cancelled) return;
      const code = reason instanceof Error ? reason.message : "unknown_error";
      const messages: Record<string, string> = {
        guild_not_found: "Бот ещё синхронизирует сервер. Обнови страницу через несколько секунд.",
        resources_failed: "Не удалось получить каналы и роли сервера.",
        audit_failed: "Не удалось получить журнал действий.",
        modules_failed: "Не удалось получить список модулей."
      };
      setError(messages[code] ?? "Не удалось загрузить выбранный сервер.");
    });

    return () => {
      cancelled = true;
    };
  }, [guildId]);

  useEffect(() => {
    if (!guildId || !selectedModule || !selectedSchema) return;
    setLoadingSettings(true);
    void fetch(
      "/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule),
      { cache: "no-store" }
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(body.error ?? "settings_failed"));
        return body as { values?: Record<string, unknown> };
      })
      .then((body) => {
        const next = normalizeValues(selectedSchema, body.values ?? {});
        setValues(next);
        setOriginalValues(next);
      })
      .catch(() => setError("Не удалось загрузить настройки модуля."))
      .finally(() => setLoadingSettings(false));
  }, [guildId, selectedModule, selectedSchema]);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function openCategory(key: Category["key"]) {
    clearMessages();
    if (key === "system") {
      setView("system");
      return;
    }
    setCategory(key);
    setView("category");
    setFunctionsOnly(false);
    setSearch("");
  }

  function openModule(key: string) {
    clearMessages();
    const meta = MODULE_META[key] ?? null;
    if (meta) setCategory(meta.category);
    setSelectedModule(key);
    setView("module");
    setFunctionsOnly(false);
    setSearch("");
  }

  async function reloadAudit(options: {
    append?: boolean;
    source?: string;
    action?: string;
    actor?: string;
  } = {}) {
    if (!guildId) return;
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ limit: "80" });
      const source = options.source ?? auditSource;
      const action = options.action ?? auditAction;
      const actor = options.actor ?? auditActor;
      if (source) params.set("source", source);
      if (action.trim()) params.set("action", action.trim());
      if (actor.trim()) params.set("actorUserId", actor.trim());
      if (options.append && auditNextBefore) params.set("before", auditNextBefore);

      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/audit?" + params.toString(),
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "audit_failed"));

      const nextEvents = (body.events ?? []) as AuditEvent[];
      setAudit((current) => options.append ? [...current, ...nextEvents] : nextEvents);
      setAuditNextBefore(typeof body.nextBefore === "string" && body.nextBefore ? body.nextBefore : null);
    } finally {
      setAuditLoading(false);
    }
  }

  function clearAuditFilters() {
    setAuditSource("");
    setAuditAction("");
    setAuditActor("");
    setAuditNextBefore(null);
    void reloadAudit({ source: "", action: "", actor: "" });
  }

  async function toggle(moduleKey: string, enabled: boolean) {
    if (!guildId) return;
    setSaving(true);
    clearMessages();
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/modules",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ moduleKey, enabled })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "toggle_failed"));
      setModules((previous) => ({ ...previous, [moduleKey]: enabled }));
      setNotice((MODULE_META[moduleKey]?.title ?? moduleKey) + (enabled ? " включён." : " выключен."));
      await reloadAudit();
    } catch {
      setError("Не удалось изменить состояние модуля.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: ModuleAction) {
    if (!guildId || !selectedModule) return;
    if (action.kind === "danger" && !window.confirm(action.confirmation ?? "Подтвердить действие?")) return;
    setSaving(true);
    clearMessages();
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/actions/" +
          encodeURIComponent(selectedModule) + "/" + encodeURIComponent(action.id),
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "action_failed"));
      setNotice(action.label + " — выполнено.");
      await reloadAudit();
    } catch {
      setError("Не удалось выполнить действие.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!guildId || !selectedModule || !selectedSchema) return;
    setSaving(true);
    clearMessages();
    try {
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/settings/" + encodeURIComponent(selectedModule),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "save_failed"));
      const next = normalizeValues(selectedSchema, body.values ?? values);
      setValues(next);
      setOriginalValues(next);
      setSavedAt(new Date().toLocaleTimeString("ru-RU"));
      setNotice("Настройки сохранены.");
      await reloadAudit();
    } catch {
      setError("Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  async function exportConfig() {
    if (!guildId) return;
    clearMessages();
    const response = await fetch(
      "/api/guilds/" + encodeURIComponent(guildId) + "/export",
      { cache: "no-store" }
    );
    if (!response.ok) {
      setError("Не удалось экспортировать конфигурацию.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "discord-server-platform-" + guildId + ".json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Конфигурация экспортирована.");
  }

  async function importConfig(file: File) {
    if (!guildId) return;
    clearMessages();
    try {
      const payload = JSON.parse(await file.text());
      const response = await fetch(
        "/api/guilds/" + encodeURIComponent(guildId) + "/import",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      if (!response.ok) throw new Error("import_failed");
      setNotice("Конфигурация импортирована.");
      await reloadAudit();
    } catch {
      setError("Файл конфигурации некорректен или импорт не удался.");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeCategory = CATEGORIES.find((item) => item.key === category) ?? CATEGORIES[0];
  const changed = JSON.stringify(values) !== JSON.stringify(originalValues);

  return (
    <main style={{ minHeight: "100vh", background: "#080a0f", color: "#f3f5f8", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1540, margin: "0 auto", padding: "16px 18px 48px" }}>
        <header style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ ...panel, display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", minWidth: 255 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "#1a2030", color: "#aab6ff", fontWeight: 800 }}>
              {selectedGuild?.name?.slice(0, 1).toUpperCase() || "D"}
            </div>
            <select
              value={guildId}
              onChange={(event) => {
                setGuildId(event.target.value);
                setSelectedModule("");
                clearMessages();
              }}
              style={{ ...selectStyle, border: 0, background: "transparent", flex: 1 }}
            >
              {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 260, position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: 10, color: "#5c6778" }}>⌕</span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (view === "module") setView("category");
              }}
              placeholder="Поиск функций, модулей и команд…"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: 34 }}
            />
          </div>

          <HealthBadge health={health} />
          <button type="button" onClick={() => setFunctionsOnly((value) => !value)} style={buttonStyle(functionsOnly ? "primary" : "secondary")}>
            {functionsOnly ? "Все функции" : "Функции"}
          </button>
          <button type="button" onClick={() => void exportConfig()} style={buttonStyle("secondary")}>Экспорт</button>
          <label style={{ ...buttonStyle("secondary"), cursor: "pointer" }}>
            Импорт
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importConfig(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button type="button" onClick={() => void logout()} style={buttonStyle("secondary")}>Выйти</button>
        </header>

        {(notice || error) && (
          <div style={{ marginBottom: 14, display: "grid", gap: 8 }}>
            {notice && <Notice tone="success" message={notice} />}
            {error && <Notice tone="error" message={error} />}
          </div>
        )}

        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Sidebar
            view={view}
            category={category}
            selectedModule={selectedModule}
            catalog={catalog}
            modules={modules}
            onOverview={() => {
              clearMessages();
              setView("overview");
              setFunctionsOnly(false);
              setSearch("");
            }}
            onCategory={openCategory}
            onFunctions={() => {
              clearMessages();
              setView("functions");
              setFunctionsOnly(true);
              setSearch("");
            }}
            onModule={openModule}
            onSystem={() => {
              clearMessages();
              setView("system");
            }}
            onAudit={() => {
              clearMessages();
              setView("audit");
            }}
          />

          <section style={{ flex: 1, minWidth: 0 }}>
            {view === "overview" && (
              <>
                <Overview
                guild={selectedGuild}
                health={health}
                catalog={catalog}
                modules={modules}
                audit={audit}
                onCategory={openCategory}
                onModule={openModule}
                onFunctions={() => {
                  setView("functions");
                  setFunctionsOnly(true);
                }}
                onToggle={(key, value) => void toggle(key, value)}
                saving={saving}
              />
              {guildId && (
                <div style={{ marginTop: 14 }}>
                  <CommunityHubPanel guildId={guildId} />
                </div>
              )}
              </>
            )}

            {view === "category" && (
              <CategoryPage
                category={activeCategory}
                catalog={filteredCatalog}
                modules={modules}
                search={search}
                functionsOnly={functionsOnly}
                onModule={openModule}
                onToggle={(key, value) => void toggle(key, value)}
                saving={saving}
              />
            )}

            {view === "functions" && (
              <FunctionsPage
                catalog={catalog}
                modules={modules}
                search={search}
                onModule={openModule}
              />
            )}

            {view === "module" && selectedModule && (
              <ModulePage
                guildId={guildId}
                module={selectedCatalog}
                schema={selectedSchema}
                meta={MODULE_META[selectedModule]}
                enabled={Boolean(modules[selectedModule])}
                loading={loadingSettings}
                values={values}
                originalValues={originalValues}
                resources={resources}
                saving={saving}
                savedAt={savedAt}
                audit={audit}
                onBack={() => setView("category")}
                onToggle={(value) => void toggle(selectedModule, value)}
                onSave={() => void saveSettings()}
                onReset={() => setValues(originalValues)}
                onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
                onAction={(action) => void runAction(action)}
                onAudit={reloadAudit}
              />
            )}

            {view === "system" && (
              <SystemPage guildId={guildId} health={health} audit={audit} onAudit={() => setView("audit")} />
            )}

            {view === "audit" && (
              <AuditPage
                audit={audit}
                source={auditSource}
                action={auditAction}
                actor={auditActor}
                loading={auditLoading}
                hasMore={Boolean(auditNextBefore)}
                onSource={setAuditSource}
                onAction={setAuditAction}
                onActor={setAuditActor}
                onApply={() => {
                  setAuditNextBefore(null);
                  void reloadAudit();
                }}
                onClear={clearAuditFilters}
                onLoadMore={() => void reloadAudit({ append: true })}
              />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Sidebar(props: {
  view: View;
  category: Category["key"];
  selectedModule: string;
  catalog: CatalogItem[];
  modules: ModuleState;
  onOverview: () => void;
  onCategory: (key: Category["key"]) => void;
  onFunctions: () => void;
  onModule: (key: string) => void;
  onSystem: () => void;
  onAudit: () => void;
}) {
  return (
    <aside style={{ width: 265, flex: "0 0 265px", position: "sticky", top: 14 }}>
      <div style={{ ...panel, padding: 11 }}>
        <div style={{ padding: "7px 10px 14px", borderBottom: "1px solid #202632", marginBottom: 9 }}>
          <div style={{ color: "#626e80", fontSize: 9, letterSpacing: 1.6 }}>DISCORD SERVER PLATFORM</div>
          <div style={{ marginTop: 4, fontSize: 19, fontWeight: 780 }}>Control Center</div>
        </div>

        <SidebarButton active={props.view === "overview"} label="Обзор" icon="⌂" onClick={props.onOverview} />
        {CATEGORIES.filter((item) => item.key !== "system").map((item) => {
          const count = props.catalog.filter((module) => MODULE_META[module.key]?.category === item.key).length;
          const enabled = props.catalog.filter((module) => MODULE_META[module.key]?.category === item.key && props.modules[module.key]).length;
          const active = props.view === "category" && props.category === item.key;
          return (
            <SidebarButton
              key={item.key}
              active={active}
              label={item.label}
              icon={item.icon}
              suffix={count ? String(enabled) + "/" + String(count) : undefined}
              onClick={() => props.onCategory(item.key)}
            />
          );
        })}

        <div style={{ margin: "12px 7px 8px", borderTop: "1px solid #202632", paddingTop: 12 }}>
          <div style={{ padding: "0 7px 6px", color: "#536074", fontSize: 9, letterSpacing: 1.2 }}>ОБЩИЕ ИНСТРУМЕНТЫ</div>
          <SidebarButton active={props.view === "functions"} label="Все функции" icon="☷" onClick={props.onFunctions} />
          <SidebarButton active={props.view === "system"} label="Система" icon="▣" onClick={props.onSystem} />
          <SidebarButton active={props.view === "audit"} label="Журнал действий" icon="↗" onClick={props.onAudit} />
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid #202632", paddingTop: 12 }}>
          <div style={{ padding: "0 7px 6px", color: "#536074", fontSize: 9, letterSpacing: 1.2 }}>БЫСТРЫЙ ДОСТУП</div>
          {props.catalog.slice(0, 6).map((item) => {
            const meta = MODULE_META[item.key];
            if (!meta) return null;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => props.onModule(item.key)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px",
                  border: 0,
                  background: props.selectedModule === item.key ? "#171c25" : "transparent",
                  color: "#dce2eb",
                  cursor: "pointer",
                  borderRadius: 9,
                  textAlign: "left"
                }}
              >
                <span style={{ color: meta.accent, width: 19, textAlign: "center" }}>{meta.icon}</span>
                <span style={{ flex: 1, fontSize: 11 }}>{meta.title}</span>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: props.modules[item.key] ? "#68d48c" : "#4d5665" }} />
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function SidebarButton(props: {
  active: boolean;
  label: string;
  icon: string;
  suffix?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 10px",
        margin: "2px 0",
        borderRadius: 10,
        border: props.active ? "1px solid #303746" : "1px solid transparent",
        background: props.active ? "#181d26" : "transparent",
        color: props.active ? "#fff" : "#c8ced8",
        cursor: "pointer",
        textAlign: "left"
      }}
    >
      <span style={{ width: 21, textAlign: "center", color: props.active ? "#b5bdff" : "#7d8899" }}>{props.icon}</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: props.active ? 680 : 530 }}>{props.label}</span>
      {props.suffix && <span style={{ color: "#637083", fontSize: 9 }}>{props.suffix}</span>}
    </button>
  );
}

function Overview(props: {
  guild?: Guild;
  health: Health;
  catalog: CatalogItem[];
  modules: ModuleState;
  audit: AuditEvent[];
  onCategory: (key: Category["key"]) => void;
  onModule: (key: string) => void;
  onFunctions: () => void;
  onToggle: (key: string, value: boolean) => void;
  saving: boolean;
}) {
  const ready = props.health?.status === "ready";
  const enabled = props.catalog.filter((item) => props.modules[item.key]);
  const mostRecent = props.audit.slice(0, 5);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={{
        ...panel,
        padding: 26,
        background: "radial-gradient(circle at 80% 18%,rgba(88,101,242,.18),transparent 34%),linear-gradient(135deg,#12192a,#0d121b)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#687487", fontSize: 9, letterSpacing: 1.5 }}>SERVER ADMINISTRATION</div>
            <h1 style={{ margin: "8px 0", fontSize: 35, letterSpacing: -1.2 }}>{props.guild?.name ?? "Discord Server"}</h1>
            <p style={{ margin: 0, color: "#98a3b3", maxWidth: 770, lineHeight: 1.6 }}>
              Единый центр управления функционалом бота. Здесь функции разделены по задачам, а настройки каждого модуля находятся рядом с его операционными инструментами.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <button type="button" onClick={props.onFunctions} style={buttonStyle("primary")}>Все функции</button>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
        <StatCard label="Участники" value={formatNumber(props.guild?.memberCount)} hint="выбранный сервер" />
        <StatCard label="Активные модули" value={String(enabled.length)} hint={"из " + props.catalog.length} />
        <StatCard label="Каналы" value={formatNumber(props.guild?.channelCount)} hint="Discord resources" />
        <StatCard label="Core" value={ready ? "Ready" : "Degraded"} hint={props.health?.database === "ready" ? "Gateway + PostgreSQL" : "требуется проверка"} />
      </div>

      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Разделы управления" eyebrow="ADMIN AREAS" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          {CATEGORIES.filter((item) => item.key !== "system").map((item) => {
            const entries = props.catalog.filter((module) => MODULE_META[module.key]?.category === item.key);
            const activeCount = entries.filter((module) => props.modules[module.key]).length;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => props.onCategory(item.key)}
                style={{
                  display: "flex",
                  gap: 13,
                  alignItems: "flex-start",
                  padding: 15,
                  background: "#0f141c",
                  border: "1px solid #242b37",
                  borderRadius: 14,
                  color: "#fff",
                  cursor: "pointer",
                  textAlign: "left"
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "#171d28", color: "#aab3c2", fontSize: 18 }}>{item.icon}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: 14 }}>{item.label}</strong>
                  <div style={{ marginTop: 4, color: "#707b8b", fontSize: 10, lineHeight: 1.5 }}>{item.summary}</div>
                  <div style={{ marginTop: 8, color: "#596577", fontSize: 9 }}>{activeCount} активных · {entries.length} модулей</div>
                </div>
                <span style={{ color: "#5f6a7a", fontSize: 16 }}>→</span>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(320px,.85fr)", gap: 14 }}>
        <div style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Активные функции" eyebrow="ENABLED" />
          <div style={{ display: "grid", gap: 8 }}>
            {enabled.slice(0, 8).map((item) => {
              const meta = MODULE_META[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => props.onModule(item.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "10px 11px",
                    background: "#0f141c",
                    border: "1px solid #232a36",
                    borderRadius: 11,
                    color: "#e9ecf1",
                    cursor: "pointer",
                    textAlign: "left"
                  }}
                >
                  <span style={{ color: meta?.accent ?? "#9aa4b3", fontSize: 18 }}>{meta?.icon ?? "•"}</span>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: "block", fontSize: 12 }}>{meta?.title ?? item.title}</strong>
                    <span style={{ display: "block", marginTop: 3, color: "#687486", fontSize: 9 }}>{meta?.summary ?? item.description}</span>
                  </span>
                  <span style={{ color: "#5e6979" }}>→</span>
                </button>
              );
            })}
            {!enabled.length && <Empty text="Нет включённых модулей." />}
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...panel, padding: 20 }}>
            <SectionHeader title="Состояние" eyebrow="HEALTH" />
            <HealthRow label="Discord Gateway" value={props.health?.discord ?? "unknown"} />
            <HealthRow label="PostgreSQL" value={props.health?.database ?? "unknown"} />
            <HealthRow label="Control Center" value={ready ? "ready" : "degraded"} />
          </div>
          <div style={{ ...panel, padding: 20 }}>
            <SectionHeader title="Последние действия" eyebrow="AUDIT" />
            {mostRecent.map((event, index) => <AuditCompact key={index} event={event} last={index === mostRecent.length - 1} />)}
            {!mostRecent.length && <Empty text="Журнал пока пуст." />}
          </div>
        </div>
      </section>
    </div>
  );
}

function CategoryPage(props: {
  category: Category;
  catalog: CatalogItem[];
  modules: ModuleState;
  search: string;
  functionsOnly: boolean;
  onModule: (key: string) => void;
  onToggle: (key: string, value: boolean) => void;
  saving: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        eyebrow={props.category.eyebrow}
        title={props.category.label}
        description={props.category.summary}
        right={<span style={{ color: "#738095", fontSize: 10 }}>{props.catalog.length} модулей</span>}
      />

      {!props.catalog.length && <Empty text={props.search ? "Ничего не найдено." : "В этом разделе пока нет подключённых модулей."} />}

      {props.catalog.map((item) => {
        const meta = MODULE_META[item.key];
        if (!meta) return null;
        return (
          <ModuleCard
            key={item.key}
            item={item}
            meta={meta}
            enabled={Boolean(props.modules[item.key])}
            functionsOnly={props.functionsOnly}
            onOpen={() => props.onModule(item.key)}
            onToggle={(value) => props.onToggle(item.key, value)}
            saving={props.saving}
          />
        );
      })}
    </div>
  );
}

function ModuleCard(props: {
  item: CatalogItem;
  meta: ModuleMeta;
  enabled: boolean;
  functionsOnly: boolean;
  onOpen: () => void;
  onToggle: (value: boolean) => void;
  saving: boolean;
}) {
  return (
    <article style={{ ...panel, padding: 17, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: props.meta.accent, opacity: props.enabled ? 1 : .22 }} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, minWidth: 0, flex: 1 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, display: "grid", placeItems: "center", background: props.meta.accent + "14", color: props.meta.accent, fontSize: 21, flexShrink: 0 }}>
            {props.meta.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{props.meta.title}</h2>
              <StatusDot active={props.enabled} />
            </div>
            <p style={{ margin: "5px 0 0", color: "#778394", fontSize: 10, lineHeight: 1.5 }}>{props.meta.summary}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span style={{ padding: "7px 9px", borderRadius: 999, border: "1px solid #2b323d", color: props.enabled ? "#7ed89b" : "#737d8c", background: props.enabled ? "#122319" : "#171b22", fontSize: 9 }}>
            {props.enabled ? "ACTIVE" : "OFF"}
          </span>
          <button type="button" onClick={() => props.onToggle(!props.enabled)} disabled={props.saving} style={buttonStyle(props.enabled ? "danger" : "primary")}>
            {props.enabled ? "Выключить" : "Включить"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 15, paddingTop: 14, borderTop: "1px solid #202632" }}>
        <div style={{ color: "#566274", fontSize: 9, letterSpacing: 1.25 }}>ФУНКЦИИ</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7, marginTop: 9 }}>
          {props.meta.functions.map((entry) => (
            <div key={entry.title} style={{ padding: "9px 10px", borderRadius: 10, background: "#0e131a", border: "1px solid #202732" }}>
              <div style={{ fontSize: 11, fontWeight: 650 }}>{entry.title}</div>
              <div style={{ marginTop: 3, color: "#687486", fontSize: 9, lineHeight: 1.45 }}>{entry.description}</div>
            </div>
          ))}
        </div>
      </div>

      {!props.functionsOnly && (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {props.meta.commands.slice(0, 5).map((command) => <CodePill key={command}>{command}</CodePill>)}
            {props.meta.commands.length > 5 && <CodePill>+{props.meta.commands.length - 5} ещё</CodePill>}
          </div>
          <button type="button" onClick={props.onOpen} style={buttonStyle("secondary")}>
            Открыть управление →
          </button>
        </div>
      )}
    </article>
  );
}

function FunctionsPage(props: {
  catalog: CatalogItem[];
  modules: ModuleState;
  search: string;
  onModule: (key: string) => void;
}) {
  const query = props.search.trim().toLocaleLowerCase();
  const groups = CATEGORIES.filter((item) => item.key !== "system").map((category) => ({
    category,
    modules: props.catalog.filter((item) => MODULE_META[item.key]?.category === category.key)
  })).filter((group) => group.modules.length);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        eyebrow="FUNCTION INDEX"
        title="Все функции"
        description="Сводный индекс того, что умеет бот сейчас. Нажми на модуль, чтобы перейти к настройкам или операционному интерфейсу."
      />
      {groups.map((group) => (
        <section key={group.category.key} style={{ ...panel, padding: 20 }}>
          <SectionHeader title={group.category.label} eyebrow={group.category.eyebrow} />
          <div style={{ display: "grid", gap: 10 }}>
            {group.modules.map((item) => {
              const meta = MODULE_META[item.key];
              const matchingFunctions = meta.functions.filter((entry) => {
                if (!query) return true;
                return [meta.title, entry.title, entry.description, ...meta.commands].join(" ").toLocaleLowerCase().includes(query);
              });
              if (!matchingFunctions.length) return null;
              return (
                <div key={item.key} style={{ padding: 14, border: "1px solid #232a35", borderRadius: 13, background: "#0f141c" }}>
                  <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: meta.accent + "14", color: meta.accent }}>{meta.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 13 }}>{meta.title}</strong>
                        <StatusDot active={Boolean(props.modules[item.key])} />
                      </div>
                      <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 7 }}>
                        {matchingFunctions.map((entry) => (
                          <div key={entry.title} style={{ padding: "8px 9px", borderRadius: 9, background: "#0c1118", border: "1px solid #1d2430" }}>
                            <div style={{ fontSize: 10, fontWeight: 650 }}>{entry.title}</div>
                            <div style={{ marginTop: 2, color: "#697486", fontSize: 9, lineHeight: 1.45 }}>{entry.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => props.onModule(item.key)} style={buttonStyle("secondary")}>Управление</button>
                  </div>
                  <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {meta.commands.map((command) => <CodePill key={command}>{command}</CodePill>)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ModulePage(props: {
  guildId: string;
  module?: CatalogItem;
  schema: Schema | null;
  meta?: ModuleMeta;
  enabled: boolean;
  loading: boolean;
  values: Record<string, unknown>;
  originalValues: Record<string, unknown>;
  resources: { channels: Resource[]; roles: Resource[] };
  saving: boolean;
  savedAt: string;
  audit: AuditEvent[];
  onBack: () => void;
  onToggle: (value: boolean) => void;
  onSave: () => void;
  onReset: () => void;
  onChange: (key: string, value: unknown) => void;
  onAction: (action: ModuleAction) => void;
  onAudit: () => void;
}) {
  const meta = props.meta ?? {
    icon: "•",
    accent: "#8a91a2",
    title: props.module?.title ?? "Модуль",
    summary: props.module?.description ?? "Модуль Discord Server Platform.",
    category: "server" as const,
    commands: [],
    functions: [],
    kind: "discord" as const
  };
  const changed = JSON.stringify(props.values) !== JSON.stringify(props.originalValues);
  const grouped = props.schema ? groupFields(props.schema.fields, props.schema.key) : [];
  const hasPanel = PANEL_KEYS.has(props.module?.key ?? "");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        eyebrow={(CATEGORIES.find((item) => item.key === meta.category)?.eyebrow ?? "MODULE")}
        title={meta.title}
        description={meta.summary}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={props.onBack} style={buttonStyle("secondary")}>← Назад</button>
            <button type="button" disabled={props.saving} onClick={() => props.onToggle(!props.enabled)} style={buttonStyle(props.enabled ? "danger" : "primary")}>
              {props.enabled ? "Выключить" : "Включить"}
            </button>
          </div>
        }
      />

      <section style={{ ...panel, padding: 17 }}>
        <div style={{ display: "flex", gap: 13, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: meta.accent + "15", color: meta.accent, fontSize: 23 }}>{meta.icon}</div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{props.enabled ? "Функция включена" : "Функция выключена"}</div>
            <div style={{ marginTop: 4, color: "#727d8e", fontSize: 10 }}>
              {props.schema
                ? "Параметры сохраняются через Management API и применяются Core-сервисом."
                : hasPanel
                  ? "Операционная панель ниже изменяет данные через существующий Core API."
                  : "Для этого модуля основные операции доступны через Discord-команды."}
            </div>
          </div>
          <StatusTag active={props.enabled} />
        </div>
      </section>

      {!!meta.commands.length && (
        <section style={{ ...panel, padding: 17 }}>
          <SectionHeader title="Команды и точки входа" eyebrow="COMMANDS" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {meta.commands.map((command) => <CodePill key={command}>{command}</CodePill>)}
          </div>
        </section>
      )}

      {!!meta.functions.length && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Функционал" eyebrow="CAPABILITIES" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9 }}>
            {meta.functions.map((entry) => (
              <div key={entry.title} style={{ padding: 11, borderRadius: 11, border: "1px solid #232a35", background: "#0d1219" }}>
                <div style={{ fontSize: 11, fontWeight: 680 }}>{entry.title}</div>
                <div style={{ marginTop: 4, color: "#697486", fontSize: 9, lineHeight: 1.5 }}>{entry.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {props.module?.key && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="История модуля" eyebrow="MODULE ACTIVITY" />
          <ModuleActivityPanel guildId={props.guildId} moduleKey={props.module.key} />
        </section>
      )}

      {props.module?.key === "moderation" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Escalation rules" eyebrow="OPERATIONS" />
          <ModerationPanel guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} onChanged={props.onAudit} />
        </section>
      )}

      {props.module?.key === "tickets" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Ticket Intake Form" eyebrow="SUPPORT FORM" />
          <TicketFormPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "autoresponder" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="AutoResponder" eyebrow="KEYWORD TRIGGERS" />
          <AutoResponderPanel guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} roles={props.resources.roles} onChanged={props.onAudit} />
        </section>
      )}

      {props.module?.key === "custom-commands" && (
        <>
          <section style={{ ...panel, padding: 20 }}>
            <SectionHeader title="Custom Commands" eyebrow="COMMAND BUILDER" />
            <CustomCommandsPanel guildId={props.guildId} roles={props.resources.roles} onChanged={props.onAudit} />
          </section>
          <section style={{ ...panel, padding: 20 }}>
            <SectionHeader title="Custom Help / Menu pages" eyebrow="SERVER UX" />
            <HelpPagesPanel guildId={props.guildId} onChanged={props.onAudit} />
          </section>
        </>
      )}

      {props.module?.key === "automod" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Правила AutoMod" eyebrow="RULE EDITOR" />
          <AutoModRulesPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            roles={props.resources.roles.filter((item) => item.manageable !== false)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "embed" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Embed Builder" eyebrow="OPERATIONS" />
          <EmbedBuilderPanel guildId={props.guildId} channels={props.resources.channels.filter((item) => item.type === 0)} onChanged={props.onAudit} />
        </section>
      )}

      {props.module?.key === "onboarding" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Onboarding Flow Builder" eyebrow="ONBOARDING FLOW" />
          <OnboardingPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            roles={props.resources.roles.filter((item) => item.manageable !== false)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "forms" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Universal Forms" eyebrow="INTERACTIVE FORMS" />
          <FormsPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "roles" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Role Panels" eyebrow="OPERATIONS" />
          <RolePanelsEditor
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            roles={props.resources.roles}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "leveling" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Level Rewards & Milestones" eyebrow="LEVELING REWARDS" />
          <LevelingRewardsPanel
            guildId={props.guildId}
            roles={props.resources.roles}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "giveaways" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Giveaways" eyebrow="OPERATIONS" />
          <GiveawaysPanel guildId={props.guildId} onChanged={props.onAudit} />
        </section>
      )}

      {props.module?.key === "analytics" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Analytics" eyebrow="OPERATIONS" />
          <AnalyticsPanel guildId={props.guildId} />
        </section>
      )}

      {props.module?.key === "security" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Security incidents" eyebrow="INCIDENTS" />
          <SecurityIncidentPanel audit={props.audit} />
        </section>
      )}

      {props.module?.key === "automation" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Automation builder" eyebrow="OPERATIONS" />
          <AutomationPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            roles={props.resources.roles.filter((item) => item.manageable !== false)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "notifications" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Notification feeds" eyebrow="OPERATIONS" />
          <NotificationsPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.module?.key === "stream-alerts" && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Stream alerts" eyebrow="LIVE INTEGRATIONS" />
          <StreamAlertsPanel
            guildId={props.guildId}
            channels={props.resources.channels.filter((item) => item.type === 0)}
            roles={props.resources.roles.filter((item) => item.manageable !== false)}
            onChanged={props.onAudit}
          />
        </section>
      )}

      {props.schema && (
        <section style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Настройки" eyebrow="CONFIGURATION" />
          {props.loading ? (
            <Loading text="Загружаем настройки…" />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {grouped.map((group) => (
                <div key={group.title} style={{ padding: 13, border: "1px solid #222a35", borderRadius: 14, background: "#0e131a" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ color: "#566275", fontSize: 9, letterSpacing: 1.2 }}>SECTION</div>
                      <h3 style={{ margin: "3px 0 0", fontSize: 14 }}>{group.title}</h3>
                    </div>
                    <span style={{ color: "#535e6f", fontSize: 9 }}>{group.fields.length} параметров</span>
                  </div>
                  <div style={{ display: "grid", gap: 9 }}>
                    {group.fields.map((field) => (
                      <SettingControl
                        key={field.key}
                        field={field}
                        value={props.values[field.key]}
                        resources={props.resources}
                        onChange={(value) => props.onChange(field.key, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {props.schema.actions?.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, paddingTop: 15, borderTop: "1px solid #202733" }}>
              {props.schema.actions.map((action) => (
                <button key={action.id} type="button" disabled={props.saving} onClick={() => props.onAction(action)} style={buttonStyle(action.kind === "danger" ? "danger" : "secondary")}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 18, paddingTop: 15, borderTop: "1px solid #202733" }}>
            <button type="button" disabled={!changed || props.saving || props.loading} onClick={props.onSave} style={buttonStyle(changed ? "primary" : "secondary")}>
              {props.saving ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" disabled={!changed || props.saving} onClick={props.onReset} style={buttonStyle("secondary")}>Сбросить</button>
            {props.savedAt && <span style={{ color: "#647082", fontSize: 10 }}>Сохранено {props.savedAt}</span>}
          </div>
        </section>
      )}

      {!props.schema && !hasPanel && (
        <section style={{ ...panel, padding: 20 }}>
          <div style={{ color: "#566274", fontSize: 9, letterSpacing: 1.2 }}>OPERATIONAL NOTE</div>
          <h3 style={{ margin: "6px 0 0", fontSize: 17 }}>Настройки через Discord</h3>
          <p style={{ margin: "6px 0 0", color: "#747f90", fontSize: 10, lineHeight: 1.55 }}>
            В текущей версии для этого модуля отдельная web-форма не нужна: команды остаются официальной точкой настройки и управления. Когда появится структурированная web-операция, она будет добавлена в этот же раздел.
          </p>
        </section>
      )}

      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Недавняя активность" eyebrow="AUDIT" action={<button type="button" onClick={props.onAudit} style={linkButton}>Открыть журнал →</button>} />
        {props.audit.slice(0, 7).map((event, index) => <AuditCompact key={index} event={event} last={index === Math.min(6, props.audit.length - 1)} />)}
        {!props.audit.length && <Empty text="Изменений ещё не было." />}
      </section>
    </div>
  );
}

function SecurityIncidentPanel({ audit }: { audit: AuditEvent[] }) {
  const incidents = audit.filter((event) => event.action.startsWith("security."));
  const raid = incidents.filter((event) => event.action === "security.raid-detected");
  const destructive = incidents.filter((event) => event.action === "security.destructive-burst");
  const responses = incidents.filter((event) => event.action === "security.response-applied");
  const latest = incidents.slice(0, 8);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <MiniMetric label="Anti-Raid" value={String(raid.length)} />
        <MiniMetric label="Destructive bursts" value={String(destructive.length)} />
        <MiniMetric label="Responses" value={String(responses.length)} />
      </div>
      {latest.length ? latest.map((event, index) => (
        <div key={String(index) + event.created_at} style={{ padding: "9px 10px", border: "1px solid #242b36", borderRadius: 10, background: "#0d1219" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <strong style={{ fontSize: 11 }}>{event.action}</strong>
            <span style={{ color: "#697486", fontSize: 9 }}>{new Date(event.created_at).toLocaleString("ru-RU")}</span>
          </div>
          <div style={{ marginTop: 4, color: "#737e8f", fontSize: 9 }}>
            target: {event.target_id ?? "—"}
            {event.metadata && Object.keys(event.metadata).length ? " · " + JSON.stringify(event.metadata).slice(0, 280) : ""}
          </div>
        </div>
      )) : (
        <div style={{ color: "#697486", fontSize: 11 }}>Security-событий в последнем окне аудита нет.</div>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, border: "1px solid #232a35", background: "#0e131a" }}>
      <div style={{ color: "#667184", fontSize: 9 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 17, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

function SystemPage(props: { guildId: string; health: Health; audit: AuditEvent[]; onAudit: () => void }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader eyebrow="SYSTEM" title="Система" description="Операционные инструменты экземпляра: fleet, здоровье Core, backups и аудит." />
      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Command Policies" eyebrow="PERMISSIONS · COOLDOWNS" />
        <CommandPolicyPanel guildId={props.guildId} />
      </section>

      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Bot Fleet" eyebrow="IDENTITIES" />
        <FleetPanel guildId={props.guildId} onChanged={props.onAudit} />
      </section>
      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Server Presets" eyebrow="CONFIGURATION SNAPSHOTS" />
        <ConfigPresetsPanel guildId={props.guildId} onChanged={props.onAudit} />
      </section>
      <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
        <div style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Здоровье" eyebrow="HEALTH" />
          <HealthRow label="Core status" value={props.health?.status ?? "unknown"} />
          <HealthRow label="Discord Gateway" value={props.health?.discord ?? "unknown"} />
          <HealthRow label="PostgreSQL" value={props.health?.database ?? "unknown"} />
        </div>
        <div style={{ ...panel, padding: 20 }}>
          <SectionHeader title="Резервные копии" eyebrow="BACKUPS" />
          <BackupPanel guildId={props.guildId} onChanged={props.onAudit} />
        </div>
      </section>
      <section style={{ ...panel, padding: 20 }}>
        <SectionHeader title="Последние изменения" eyebrow="AUDIT" action={<button type="button" onClick={props.onAudit} style={linkButton}>Полный журнал →</button>} />
        {props.audit.slice(0, 10).map((event, index) => <AuditCompact key={index} event={event} last={index === Math.min(9, props.audit.length - 1)} />)}
        {!props.audit.length && <Empty text="Журнал пуст." />}
      </section>
    </div>
  );
}

function AuditPage(props: {
  audit: AuditEvent[];
  source: string;
  action: string;
  actor: string;
  loading: boolean;
  hasMore: boolean;
  onSource: (value: string) => void;
  onAction: (value: string) => void;
  onActor: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
  onLoadMore: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        eyebrow="AUDIT LOG"
        title="Журнал действий"
        description="Административные изменения, действия Discord-пользователей и системные события с серверным хранением."
      />
      <section style={{ ...panel, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px minmax(180px,1fr) 190px auto auto", gap: 8, alignItems: "center" }}>
          <select value={props.source} onChange={(event) => props.onSource(event.target.value)} style={selectStyle}>
            <option value="">Все источники</option>
            <option value="dashboard">Dashboard</option>
            <option value="discord">Discord</option>
            <option value="system">System</option>
          </select>
          <input
            value={props.action}
            onChange={(event) => props.onAction(event.target.value)}
            placeholder="Поиск по action…"
            maxLength={120}
            style={inputStyle}
          />
          <input
            value={props.actor}
            onChange={(event) => props.onActor(event.target.value)}
            placeholder="Actor user ID"
            maxLength={20}
            inputMode="numeric"
            style={inputStyle}
          />
          <button type="button" onClick={props.onApply} disabled={props.loading} style={buttonStyle("primary")}>
            {props.loading ? "Загрузка…" : "Применить"}
          </button>
          <button type="button" onClick={props.onClear} disabled={props.loading} style={secondaryButtonStyle}>
            Сбросить
          </button>
        </div>
      </section>

      <section style={{ ...panel, padding: 20 }}>
        {props.audit.length
          ? (
            <>
              {props.audit.map((event, index) => (
                <AuditCompact key={event.id ?? event.created_at + ":" + index} event={event} last={index === props.audit.length - 1} />
              ))}
              {props.hasMore && (
                <button type="button" onClick={props.onLoadMore} disabled={props.loading} style={{ ...secondaryButtonStyle, width: "100%", marginTop: 12 }}>
                  {props.loading ? "Загрузка…" : "Загрузить ещё"}
                </button>
              )}
            </>
          )
          : <Empty text={props.loading ? "Загрузка журнала…" : "По заданным фильтрам записей нет."} />}
      </section>
    </div>
  );
}

function groupFields(fields: Field[], moduleKey: string): Array<{ title: string; fields: Field[] }> {
  const groups = new Map<string, Field[]>();

  for (const field of fields) {
    const title = settingGroup(field, moduleKey);
    const entries = groups.get(title) ?? [];
    entries.push(field);
    groups.set(title, entries);
  }

  return [...groups.entries()].map(([title, grouped]) => ({ title, fields: grouped }));
}

function settingGroup(field: Field, moduleKey: string): string {
  const key = field.key;
  const maps: Record<string, Record<string, string>> = {
    "temporary-voice": {
      triggerChannelId: "Создание комнат",
      categoryId: "Создание комнат",
      defaultLimit: "Ограничения",
      privateByDefault: "Приватность"
    },
    automod: {
      blockedWords: "Фильтр контента",
      maxMentions: "Антиспам",
      maxCapsRatio: "Антиспам",
      maxRepeatedMessages: "Антиспам",
      repeatedWindowSeconds: "Антиспам",
      blockLinks: "Ссылки",
      blockInvites: "Ссылки",
      maxLinks: "Ссылки",
      maxEmojis: "Ограничения",
      maxLineLength: "Ограничения",
      exemptChannelIds: "Исключения",
      exemptRoleIds: "Исключения",
      deleteMessage: "Реакция",
      timeoutMinutes: "Реакция"
    },
    verification: {
      channelId: "Каналы",
      logChannelId: "Каналы",
      verifiedRoleId: "Роли",
      quarantineRoleId: "Роли",
      codeTtlMinutes: "Код проверки"
    },
    welcome: {
      channelId: "Канал",
      message: "Сообщение",
      dm: "Доставка",
      embed: "Доставка"
    },
    security: {
      maxJoins: "Anti-Raid",
      windowSeconds: "Anti-Raid",
      maxDestructiveActions: "Destructive burst",
      destructiveWindowSeconds: "Destructive burst",
      quarantineRoleId: "Quarantine",
      logChannelId: "Логи",
      raidQuarantineEnabled: "Anti-Raid",
      destructiveRoleRemoval: "Destructive burst",
      destructiveQuarantineEnabled: "Destructive burst"
    },
    leveling: {
      xpPerMessage: "XP",
      cooldownSeconds: "XP",
      announceLevelUp: "Уведомления"
    },
    tickets: {
      categoryId: "Маршрутизация",
      staffRoleId: "Staff",
      transcriptChannelId: "Transcripts"
    },
    starboard: {
      channelId: "Публикация",
      threshold: "Публикация",
      ignoreSelfReaction: "Фильтры",
      ignoreBots: "Фильтры"
    },
    music: {
      preferredTextChannelId: "Канал",
      defaultVolume: "Playback",
      announceTrackStart: "Playback",
      autoplay: "Autoplay"
    }
  };

  return maps[moduleKey]?.[key] ?? "Основные настройки";
}

function SettingControl(props: {
  field: Field;
  value: unknown;
  resources: { channels: Resource[]; roles: Resource[] };
  onChange: (value: unknown) => void;
}) {
  const common = { ...inputStyle, width: "100%", boxSizing: "border-box" as const };
  return (
    <div style={{ padding: 12, borderRadius: 12, background: "#0c1118", border: "1px solid #1f2732" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 7, alignItems: "baseline", flexWrap: "wrap" }}>
        <label style={{ fontSize: 11, fontWeight: 700 }}>{props.field.label}</label>
        {props.field.description && <span style={{ color: "#687486", fontSize: 9 }}>{props.field.description}</span>}
      </div>

      {props.field.type === "boolean" && (
        <button
          type="button"
          onClick={() => props.onChange(props.value !== true)}
          style={{
            minWidth: 114,
            borderRadius: 999,
            padding: "8px 12px",
            border: props.value === true ? "1px solid #3b8659" : "1px solid #343b47",
            background: props.value === true ? "#173522" : "#171b22",
            color: "#fff",
            cursor: "pointer"
          }}
        >
          {props.value === true ? "Включено" : "Выключено"}
        </button>
      )}

      {props.field.type === "text" && (
        <input
          value={typeof props.value === "string" ? props.value : ""}
          maxLength={props.field.maxLength}
          onChange={(event) => props.onChange(event.target.value)}
          style={common}
        />
      )}

      {props.field.type === "number" && (
        <input
          type="number"
          value={typeof props.value === "number" ? props.value : ""}
          min={props.field.min}
          max={props.field.max}
          step={props.field.step ?? 1}
          onChange={(event) => props.onChange(event.target.value === "" ? null : Number(event.target.value))}
          style={common}
        />
      )}

      {props.field.type === "textarea" && (
        <textarea
          value={
            Array.isArray(props.value)
              ? props.value.join("\n")
              : typeof props.value === "string"
                ? props.value
                : ""
          }
          onChange={(event) =>
            props.onChange(
              props.field.key === "blockedWords"
                ? event.target.value.split("\n").map((item) => item.trim()).filter(Boolean)
                : event.target.value
            )
          }
          rows={5}
          style={{ ...common, resize: "vertical", lineHeight: 1.5 }}
        />
      )}

      {(props.field.type === "channel" || props.field.type === "role") && (
        <select
          value={typeof props.value === "string" ? props.value : ""}
          onChange={(event) => props.onChange(event.target.value || null)}
          style={common}
        >
          <option value="">Не выбрано</option>
          {(props.field.type === "channel" ? props.resources.channels : props.resources.roles).map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name}
              {resource.type === 4 ? " · категория" : resource.manageable === false ? " · hierarchy" : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function PageHeader(props: { eyebrow: string; title: string; description: string; right?: ReactNode }) {
  return (
    <section style={{ ...panel, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#687487", fontSize: 9, letterSpacing: 1.55 }}>{props.eyebrow}</div>
          <h1 style={{ margin: "7px 0", fontSize: 31, letterSpacing: -.85 }}>{props.title}</h1>
          <p style={{ margin: 0, color: "#8791a0", lineHeight: 1.55, maxWidth: 820 }}>{props.description}</p>
        </div>
        {props.right}
      </div>
    </section>
  );
}

function SectionHeader(props: { title: string; eyebrow: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 13 }}>
      <div>
        <div style={{ color: "#5d697a", fontSize: 9, letterSpacing: 1.25 }}>{props.eyebrow}</div>
        <h2 style={{ margin: "4px 0 0", fontSize: 17 }}>{props.title}</h2>
      </div>
      {props.action}
    </div>
  );
}

function StatCard(props: { label: string; value: string; hint: string }) {
  return (
    <div style={{ ...panel, padding: 15 }}>
      <div style={{ color: "#717c8d", fontSize: 9 }}>{props.label}</div>
      <div style={{ marginTop: 6, fontSize: 26, fontWeight: 770 }}>{props.value}</div>
      <div style={{ marginTop: 3, color: "#505b6b", fontSize: 8 }}>{props.hint}</div>
    </div>
  );
}

function HealthRow(props: { label: string; value: string }) {
  const good = props.value === "ready";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "8px 0", borderBottom: "1px solid #1f2631" }}>
      <span style={{ color: "#8791a1", fontSize: 10 }}>{props.label}</span>
      <span style={{ color: good ? "#73d69a" : "#d4aa72", fontSize: 10 }}>{props.value}</span>
    </div>
  );
}

function AuditCompact(props: { event: AuditEvent; last: boolean }) {
  const actor = props.event.actor_user_id ?? "system";
  const source = props.event.source ?? "system";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: props.last ? "none" : "1px solid #1f2631" }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "#171c25", color: "#8b98aa", fontSize: 9 }}>
        {source === "discord" ? "DC" : source === "dashboard" ? "UI" : "SYS"}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.event.action}</div>
        <div style={{ marginTop: 3, color: "#626d7d", fontSize: 8 }}>
          {source} · {actor} · {props.event.target_type ?? "system"}:{props.event.target_id ?? "—"}
        </div>
      </div>
      <time style={{ color: "#5f6978", fontSize: 8, whiteSpace: "nowrap" }}>{new Date(props.event.created_at).toLocaleString("ru-RU")}</time>
    </div>
  );
}

function HealthBadge(props: { health: Health }) {
  const ready = props.health?.status === "ready";
  return (
    <div style={{
      padding: "8px 10px",
      borderRadius: 999,
      border: "1px solid " + (ready ? "#2d6847" : "#5a4a31"),
      background: ready ? "#12271a" : "#241e14",
      color: ready ? "#7bdc9d" : "#deb87d",
      fontSize: 9
    }}>
      ● {ready ? "Healthy" : "Degraded"}
    </div>
  );
}

function StatusTag(props: { active: boolean }) {
  return (
    <div style={{
      padding: "7px 10px",
      borderRadius: 999,
      background: props.active ? "#13261a" : "#191d24",
      color: props.active ? "#7ed89b" : "#788292",
      fontSize: 9,
      border: "1px solid " + (props.active ? "#295a3e" : "#2b313c")
    }}>
      {props.active ? "ACTIVE" : "OFF"}
    </div>
  );
}

function StatusDot(props: { active: boolean }) {
  return <span style={{ width: 6, height: 6, borderRadius: 99, background: props.active ? "#68d48c" : "#4f5765", display: "inline-block" }} />;
}

function CodePill({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "5px 7px",
      border: "1px solid #29313d",
      borderRadius: 7,
      background: "#0b1017",
      color: "#9ca7b7",
      fontSize: 8,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    }}>
      {children}
    </span>
  );
}

function Notice(props: { tone: "success" | "error"; message: string }) {
  const good = props.tone === "success";
  return (
    <div style={{
      padding: "10px 12px",
      borderRadius: 11,
      background: good ? "#12271a" : "#32191b",
      border: "1px solid " + (good ? "#285638" : "#63292d"),
      color: good ? "#8cdaa6" : "#ffb1b1",
      fontSize: 10
    }}>
      {props.message}
    </div>
  );
}

function Empty(props: { text: string }) {
  return <div style={{ padding: "24px 4px", textAlign: "center", color: "#646e7d", fontSize: 10 }}>{props.text}</div>;
}

function Loading(props: { text: string }) {
  return <div style={{ padding: "30px 0", textAlign: "center", color: "#657082", fontSize: 10 }}>{props.text}</div>;
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ border: 0, background: "transparent", color: "#8b98ad", fontSize: 9, cursor: "pointer", padding: 0 }}>
      {children}
    </button>
  );
}

const linkButton = { border: 0, background: "transparent", color: "#8b98ad", fontSize: 9, cursor: "pointer", padding: 0 } as const;

function formatNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ru-RU") : "—";
}

function normalizeValues(schema: Schema, values: Record<string, unknown>) {
  const next = { ...values };
  for (const field of schema.fields) {
    if (field.type === "boolean" && typeof next[field.key] !== "boolean") next[field.key] = false;
    if (field.type === "number" && typeof next[field.key] !== "number") next[field.key] = field.min ?? 0;
    if (field.type === "textarea" && next[field.key] === undefined) next[field.key] = field.key === "blockedWords" ? [] : "";
    if ((field.type === "channel" || field.type === "role" || field.type === "text") && next[field.key] === undefined) next[field.key] = null;
  }
  return next;
}

function buttonStyle(kind: "primary" | "secondary" | "danger") {
  const background = kind === "primary" ? "#5865f2" : kind === "danger" ? "#4b2227" : "#171b23";
  const border = kind === "primary" ? "#5865f2" : kind === "danger" ? "#79343c" : "#303746";
  return {
    border: "1px solid " + border,
    background,
    color: "#fff",
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 620
  } as const;
}
