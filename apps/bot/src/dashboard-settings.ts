import type { Database } from "./database.js";
import { MODULE_CATALOG, type ModuleKey } from "./modules/catalog.js";

export type SettingFieldType = "text" | "number" | "boolean" | "channel" | "role" | "textarea";

export type SettingField = {
  key: string;
  label: string;
  type: SettingFieldType;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
};

export type ModuleAction = { id: string; label: string; kind?: "safe" | "danger"; confirmation?: string };

export type ModuleSettingsSchema = {
  key: ModuleKey;
  title: string;
  fields: SettingField[];
  actions?: ModuleAction[];
};

export const DASHBOARD_SETTINGS: readonly ModuleSettingsSchema[] = [
  {
    key: "temporary-voice",
    title: "Temporary Voice",
    fields: [
      { key: "triggerChannelId", label: "Триггер-канал", type: "channel" },
      { key: "categoryId", label: "Категория комнат", type: "channel" },
      { key: "defaultLimit", label: "Лимит участников", type: "number", min: 0, max: 99 },
      { key: "privateByDefault", label: "Приватные комнаты", type: "boolean" }
    ],
    actions: [{ id: "reconcile", label: "Синхронизировать Temporary Voice", kind: "safe" }]
  },
  {
    key: "automod",
    title: "AutoMod",
    fields: [
      { key: "blockedWords", label: "Запрещённые слова", type: "textarea", description: "По одному значению на строку." },
      { key: "maxMentions", label: "Макс. упоминаний", type: "number", min: 1, max: 50 },
      { key: "maxCapsRatio", label: "Доля CAPS", type: "number", min: 0, max: 1, step: 0.05 },
      { key: "maxRepeatedMessages", label: "Повторов до срабатывания", type: "number", min: 2, max: 20 },
      { key: "repeatedWindowSeconds", label: "Окно повторов, сек.", type: "number", min: 2, max: 120 },
      { key: "blockLinks", label: "Блокировать ссылки", type: "boolean" },
      { key: "blockInvites", label: "Блокировать Discord invites", type: "boolean" },
      { key: "maxLinks", label: "Макс. ссылок в сообщении", type: "number", min: 0, max: 20 },
      { key: "maxEmojis", label: "Макс. emoji", type: "number", min: 0, max: 200 },
      { key: "maxLineLength", label: "Макс. длина строки", type: "number", min: 0, max: 4000 },
      { key: "exemptChannelIds", label: "Исключённые каналы", type: "textarea", description: "ID через пробел или новую строку." },
      { key: "exemptRoleIds", label: "Исключённые роли", type: "textarea", description: "ID через пробел или новую строку." },
      { key: "deleteMessage", label: "Удалять нарушающее сообщение", type: "boolean" },
      { key: "timeoutMinutes", label: "Timeout, минут", type: "number", min: 0, max: 40320 }
    ],
  },
  {
    key: "verification",
    title: "Verification",
    fields: [
      { key: "channelId", label: "Канал verification", type: "channel" },
      { key: "verifiedRoleId", label: "Verified role", type: "role" },
      { key: "quarantineRoleId", label: "Quarantine role", type: "role" },
      { key: "logChannelId", label: "Канал логов", type: "channel" },
      { key: "codeTtlMinutes", label: "Время действия кода, мин.", type: "number", min: 2, max: 60 }
    ]
  },
  {
    key: "welcome",
    title: "Welcome",
    fields: [
      { key: "channelId", label: "Канал приветствия", type: "channel" },
      { key: "message", label: "Сообщение", type: "textarea" },
      { key: "dm", label: "Дублировать в ЛС", type: "boolean" },
      { key: "embed", label: "Embed", type: "boolean" },
      { key: "goodbyeEnabled", label: "Goodbye", type: "boolean" },
      { key: "goodbyeChannelId", label: "Канал Goodbye", type: "channel" },
      { key: "goodbyeMessage", label: "Сообщение Goodbye", type: "textarea" },
      { key: "goodbyeEmbed", label: "Goodbye Embed", type: "boolean" },
      { key: "starterRoleIds", label: "Стартовые роли", type: "textarea", description: "ID ролей через пробел." },
      { key: "restoreRoles", label: "Восстанавливать роли вернувшимся", type: "boolean" }
    ]
  },
  {
    key: "security",
    title: "Security / Anti-Raid",
    fields: [
      { key: "maxJoins", label: "Входов до тревоги", type: "number", min: 2, max: 200 },
      { key: "windowSeconds", label: "Окно Anti-Raid, сек.", type: "number", min: 5, max: 300 },
      { key: "maxDestructiveActions", label: "Destructive actions до тревоги", type: "number", min: 2, max: 100 },
      { key: "destructiveWindowSeconds", label: "Окно destructive actions, сек.", type: "number", min: 5, max: 300 },
      { key: "incidentDurationSeconds", label: "Длительность инцидента, сек.", type: "number", min: 60, max: 3600 },
      { key: "autoQuarantine", label: "Автоматический quarantine", type: "boolean" },
      { key: "removeExecutorRoles", label: "Снимать роли исполнителя при Anti-Nuke", type: "boolean" },
      { key: "quarantineRoleId", label: "Quarantine role", type: "role" },
      { key: "logChannelId", label: "Security log channel", type: "channel" }
    ],
    actions: [{ id: "check-hierarchy", label: "Проверить role hierarchy", kind: "safe" }]
  },
  {
    key: "leveling",
    title: "Leveling",
    fields: [
      { key: "xpPerMessage", label: "XP за сообщение", type: "number", min: 1, max: 1000 },
      { key: "cooldownSeconds", label: "Cooldown сообщений, сек.", type: "number", min: 0, max: 3600 },
      { key: "announceLevelUp", label: "Объявлять новый уровень", type: "boolean" },
      { key: "voiceEnabled", label: "XP за нахождение в voice", type: "boolean" },
      { key: "voiceXpPerMinute", label: "Voice XP в минуту", type: "number", min: 0, max: 1000 },
      { key: "voiceIgnoreAfk", label: "Не считать AFK-канал", type: "boolean" },
      { key: "voiceMinMembers", label: "Минимум участников в voice", type: "number", min: 1, max: 99 },
      { key: "dailyXpCap", label: "Дневной лимит XP (0 = без лимита)", type: "number", min: 0, max: 1000000 }
    ]
  },
  {
    key: "tickets",
    title: "Tickets",
    fields: [
      { key: "categoryId", label: "Категория тикетов", type: "channel" },
      { key: "staffRoleId", label: "Staff role", type: "role" },
      { key: "transcriptChannelId", label: "Канал transcript", type: "channel" }
    ]
  },
  {
    key: "starboard",
    title: "Starboard",
    fields: [
      { key: "channelId", label: "Starboard channel", type: "channel" },
      { key: "threshold", label: "Звёзд до публикации", type: "number", min: 1, max: 100 },
      { key: "ignoreSelfReaction", label: "Игнорировать свою реакцию", type: "boolean" },
      { key: "ignoreBots", label: "Игнорировать ботов", type: "boolean" }
    ]
  },
  {
    key: "logging",
    title: "Logging",
    fields: [
      { key: "channelId", label: "Канал логов", type: "channel" },
      { key: "messageDelete", label: "Удаление сообщений", type: "boolean" },
      { key: "messageEdit", label: "Изменение сообщений", type: "boolean" },
      { key: "memberJoin", label: "Вход участников", type: "boolean" },
      { key: "memberLeave", label: "Выход участников", type: "boolean" },
      { key: "memberUpdate", label: "Изменение участников", type: "boolean" },
      { key: "voice", label: "Voice activity", type: "boolean" },
      { key: "channelDelete", label: "Удаление каналов", type: "boolean" },
      { key: "roleDelete", label: "Удаление ролей", type: "boolean" },
      { key: "bans", label: "Ban / Unban", type: "boolean" }
    ]
  },
  {
    key: "music",
    title: "Music / Lavalink",
    fields: [
      { key: "preferredTextChannelId", label: "Канал объявлений", type: "channel" },
      { key: "defaultVolume", label: "Громкость по умолчанию", type: "number", min: 0, max: 200 },
      { key: "announceTrackStart", label: "Объявлять начало трека", type: "boolean" },
      { key: "autoplay", label: "Autoplay", type: "boolean", description: "После окончания очереди искать следующий трек автоматически." },
      { key: "autoLeaveSeconds", label: "Автовыход из voice после простоя, сек.", type: "number", min: 0, max: 86400 }
    ]
  }
];

type StorageSpec = {
  table: string;
  columns: Record<string, string>;
};

const STORAGE: Partial<Record<ModuleKey, StorageSpec>> = {
  "temporary-voice": {
    table: "guild_settings",
    columns: {
      triggerChannelId: "temp_voice_trigger_channel_id",
      categoryId: "temp_voice_category_id",
      defaultLimit: "temp_voice_default_limit",
      privateByDefault: "temp_voice_private"
    }
  },
  automod: {
    table: "automod_settings",
    columns: {
      blockedWords: "blocked_words",
      maxMentions: "max_mentions",
      maxCapsRatio: "max_caps_ratio",
      maxRepeatedMessages: "max_repeated_messages",
      repeatedWindowSeconds: "repeated_window_seconds",
      blockLinks: "block_links",
      blockInvites: "block_invites",
      maxLinks: "max_links",
      maxEmojis: "max_emojis",
      maxLineLength: "max_line_length",
      exemptChannelIds: "exempt_channel_ids",
      exemptRoleIds: "exempt_role_ids",
      deleteMessage: "delete_message",
      timeoutMinutes: "timeout_minutes"
    }
  },
  verification: {
    table: "verification_settings",
    columns: {
      channelId: "channel_id",
      verifiedRoleId: "verified_role_id",
      quarantineRoleId: "quarantine_role_id",
      logChannelId: "log_channel_id",
      codeTtlMinutes: "code_ttl_minutes"
    }
  },
  welcome: {
    table: "welcome_settings",
    columns: {
      channelId: "channel_id",
      message: "message",
      dm: "dm",
      embed: "embed",
      goodbyeEnabled: "goodbye_enabled",
      goodbyeChannelId: "goodbye_channel_id",
      goodbyeMessage: "goodbye_message",
      goodbyeEmbed: "goodbye_embed",
      starterRoleIds: "starter_role_ids",
      restoreRoles: "restore_roles"
    }
  },
  security: {
    table: "security_settings",
    columns: {
      maxJoins: "max_joins",
      windowSeconds: "window_seconds",
      maxDestructiveActions: "max_destructive_actions",
      destructiveWindowSeconds: "destructive_window_seconds",
      incidentDurationSeconds: "incident_duration_seconds",
      autoQuarantine: "auto_quarantine",
      removeExecutorRoles: "remove_executor_roles",
      quarantineRoleId: "quarantine_role_id",
      logChannelId: "log_channel_id"
    }
  },
  leveling: {
    table: "leveling_settings",
    columns: {
      xpPerMessage: "xp_per_message",
      cooldownSeconds: "cooldown_seconds",
      announceLevelUp: "announce_level_up",
      voiceEnabled: "voice_enabled",
      voiceXpPerMinute: "voice_xp_per_minute",
      voiceIgnoreAfk: "voice_ignore_afk",
      voiceMinMembers: "voice_min_members",
      dailyXpCap: "daily_xp_cap"
    }
  },
  tickets: {
    table: "ticket_settings",
    columns: {
      categoryId: "category_id",
      staffRoleId: "staff_role_id",
      transcriptChannelId: "transcript_channel_id"
    }
  },
  starboard: {
    table: "starboard_settings",
    columns: {
      channelId: "channel_id",
      threshold: "threshold",
      ignoreSelfReaction: "ignore_self_reaction",
      ignoreBots: "ignore_bots"
    }
  },
  logging: {
    table: "logging_settings",
    columns: {
      channelId: "channel_id",
      messageDelete: "message_delete",
      messageEdit: "message_edit",
      memberJoin: "member_join",
      memberLeave: "member_leave",
      memberUpdate: "member_update",
      voice: "voice",
      channelDelete: "channel_delete",
      roleDelete: "role_delete",
      bans: "bans"
    }
  },
  music: {
    table: "music_settings",
    columns: {
      preferredTextChannelId: "preferred_text_channel_id",
      defaultVolume: "default_volume",
      announceTrackStart: "announce_track_start",
      autoplay: "autoplay",
      autoLeaveSeconds: "auto_leave_seconds"
    }
  }
};

export class DashboardSettingsService {
  constructor(private readonly db: Database) {}

  schema(moduleKey?: ModuleKey): ModuleSettingsSchema[] {
    const source = moduleKey
      ? DASHBOARD_SETTINGS.filter((item) => item.key === moduleKey)
      : DASHBOARD_SETTINGS;
    return source.map((item) => structuredClone(item));
  }

  async getGeneral(guildId: string): Promise<{
    commandPrefix: string;
    locale: string;
    timezone: string;
    djRoleId: string | null;
    moderatorRoleIds: string[];
    defaultLogChannelId: string | null;
    auditLogEnabled: boolean;
  }> {
    const result = await this.db.query<{
      command_prefix: string;
      locale: string;
      timezone: string;
      dj_role_id: string | null;
      moderator_role_ids: string;
      default_log_channel_id: string | null;
      audit_log_enabled: boolean;
    }>(
      "SELECT command_prefix,locale,timezone,dj_role_id,moderator_role_ids,default_log_channel_id,audit_log_enabled FROM guild_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      commandPrefix: row?.command_prefix || "!",
      locale: row?.locale || "ru",
      timezone: row?.timezone || "UTC",
      djRoleId: row?.dj_role_id ?? null,
      moderatorRoleIds: row?.moderator_role_ids ? row.moderator_role_ids.split(/[,\s]+/).filter(Boolean) : [],
      defaultLogChannelId: row?.default_log_channel_id ?? null,
      auditLogEnabled: row?.audit_log_enabled ?? false
    };
  }

  async setGeneral(
    guildId: string,
    values: {
      commandPrefix?: string;
      locale?: string;
      timezone?: string;
      djRoleId?: string | null;
      moderatorRoleIds?: string[];
      defaultLogChannelId?: string | null;
      auditLogEnabled?: boolean;
    }
  ): Promise<Awaited<ReturnType<DashboardSettingsService["getGeneral"]>>> {
    const current = await this.getGeneral(guildId);
    const commandPrefix = values.commandPrefix ?? current.commandPrefix;
    if (!/^[!?.$%#^~]{1,3}$/.test(commandPrefix)) throw new Error("invalid_command_prefix");
    const locale = values.locale ?? current.locale;
    if (!["ru","en"].includes(locale)) throw new Error("invalid_locale");
    const timezone = values.timezone ?? current.timezone;
    if (timezone.length < 1 || timezone.length > 64) throw new Error("invalid_timezone");
    const djRoleId = values.djRoleId === undefined ? current.djRoleId : values.djRoleId;
    const moderatorRoleIds = values.moderatorRoleIds ?? current.moderatorRoleIds;
    const defaultLogChannelId = values.defaultLogChannelId === undefined ? current.defaultLogChannelId : values.defaultLogChannelId;
    const auditLogEnabled = values.auditLogEnabled ?? current.auditLogEnabled;

    await this.db.query(
      `INSERT INTO guild_settings(guild_id,command_prefix,locale,timezone,dj_role_id,moderator_role_ids,default_log_channel_id,audit_log_enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(guild_id) DO UPDATE SET
         command_prefix=EXCLUDED.command_prefix,
         locale=EXCLUDED.locale,
         timezone=EXCLUDED.timezone,
         dj_role_id=EXCLUDED.dj_role_id,
         moderator_role_ids=EXCLUDED.moderator_role_ids,
         default_log_channel_id=EXCLUDED.default_log_channel_id,
         audit_log_enabled=EXCLUDED.audit_log_enabled,
         updated_at=now()`,
      [guildId,commandPrefix,locale,timezone,djRoleId,moderatorRoleIds.join(","),defaultLogChannelId,auditLogEnabled]
    );

    return this.getGeneral(guildId);
  }

  async get(guildId: string, moduleKey: ModuleKey): Promise<Record<string, unknown>> {
    const spec = STORAGE[moduleKey];
    if (!spec) return {};

    const columns = Object.values(spec.columns);
    if (columns.length === 0) return {};

    const safeColumns = columns.map(quoteIdentifier).join(",");
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${safeColumns} FROM ${quoteIdentifier(spec.table)} WHERE guild_id=$1`,
      [guildId]
    );
    const row = result.rows[0];
    if (!row) return {};

    const output: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(spec.columns)) {
      output[key] = row[column];
    }
    return output;
  }

  async set(
    guildId: string,
    moduleKey: ModuleKey,
    values: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const schema = DASHBOARD_SETTINGS.find((item) => item.key === moduleKey);
    const spec = STORAGE[moduleKey];
    if (!schema || !spec) throw new Error("settings_not_supported");

    const current = await this.get(guildId, moduleKey);
    const validated = validateValues(schema.fields, { ...current, ...values });
    const entries = Object.entries(spec.columns);

    const columns = entries.map(([, column]) => quoteIdentifier(column));
    const placeholders = entries.map((_, index) => `$${index + 2}`);
    const updates = entries.map(([, column]) => `${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`);

    await this.db.query(
      `INSERT INTO ${quoteIdentifier(spec.table)}
       (guild_id,${columns.join(",")})
       VALUES($1,${placeholders.join(",")})
       ON CONFLICT(guild_id) DO UPDATE SET
       ${updates.join(",")},updated_at=now()`,
      [guildId, ...entries.map(([key]) => validated[key])]
    );

    return this.get(guildId, moduleKey);
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("unsafe_identifier");
  return `"${value}"`;
}

function validateValues(
  fields: SettingField[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (!(field.key in values)) continue;
    const value = values[field.key];

    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new Error(`invalid_${field.key}`);
      result[field.key] = value;
      continue;
    }

    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid_${field.key}`);
      if (field.min !== undefined && value < field.min) throw new Error(`invalid_${field.key}`);
      if (field.max !== undefined && value > field.max) throw new Error(`invalid_${field.key}`);
      result[field.key] = value;
      continue;
    }

    if (field.type === "textarea") {
      if (field.key === "blockedWords") {
        if (!Array.isArray(value) || value.length > 500 || value.some((item) => typeof item !== "string" || item.length > 200)) {
          throw new Error(`invalid_${field.key}`);
        }
        result[field.key] = value.map((item) => item.trim()).filter(Boolean);
      } else {
        if (typeof value !== "string" || value.length > 10_000) throw new Error(`invalid_${field.key}`);
        result[field.key] = value;
      }
      continue;
    }

    if (field.type === "text" || field.type === "channel" || field.type === "role") {
      if (value !== null && typeof value !== "string") throw new Error(`invalid_${field.key}`);
      if (typeof value === "string" && value.length > 200) throw new Error(`invalid_${field.key}`);
      result[field.key] = value ?? null;
      continue;
    }
  }

  return result;
}

export function moduleExists(moduleKey: string): moduleKey is ModuleKey {
  return MODULE_CATALOG.some((module) => module.key === moduleKey);
}
