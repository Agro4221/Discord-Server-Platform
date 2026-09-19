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

export type ModuleSettingsSchema = {
  key: ModuleKey;
  title: string;
  fields: SettingField[];
  actionHints?: string[];
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
    actionHints: ["Проверить права бота", "Очистить осиротевшие комнаты"]
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
      { key: "deleteMessage", label: "Удалять нарушающее сообщение", type: "boolean" },
      { key: "timeoutMinutes", label: "Timeout, минут", type: "number", min: 0, max: 40320 }
    ]
  },
  {
    key: "verification",
    title: "Verification",
    fields: [
      { key: "channelId", label: "Канал verification", type: "channel" },
      { key: "verifiedRoleId", label: "Verified role", type: "role" },
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
      { key: "embed", label: "Embed", type: "boolean" }
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
      { key: "quarantineRoleId", label: "Quarantine role", type: "role" },
      { key: "logChannelId", label: "Security log channel", type: "channel" }
    ],
    actionHints: ["Проверить role hierarchy", "Проверить права Manage Roles"]
  },
  {
    key: "leveling",
    title: "Leveling",
    fields: [
      { key: "xpPerMessage", label: "XP за сообщение", type: "number", min: 1, max: 1000 },
      { key: "cooldownSeconds", label: "Cooldown, сек.", type: "number", min: 0, max: 3600 },
      { key: "announceLevelUp", label: "Объявлять новый уровень", type: "boolean" }
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
    key: "music",
    title: "Music / Lavalink",
    fields: [
      { key: "preferredTextChannelId", label: "Канал объявлений", type: "channel" },
      { key: "defaultVolume", label: "Громкость по умолчанию", type: "number", min: 0, max: 200 },
      { key: "announceTrackStart", label: "Объявлять начало трека", type: "boolean" }
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
      deleteMessage: "delete_message",
      timeoutMinutes: "timeout_minutes"
    }
  },
  verification: {
    table: "verification_settings",
    columns: {
      channelId: "channel_id",
      verifiedRoleId: "verified_role_id",
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
      embed: "embed"
    }
  },
  security: {
    table: "security_settings",
    columns: {
      maxJoins: "max_joins",
      windowSeconds: "window_seconds",
      maxDestructiveActions: "max_destructive_actions",
      destructiveWindowSeconds: "destructive_window_seconds",
      quarantineRoleId: "quarantine_role_id",
      logChannelId: "log_channel_id"
    }
  },
  leveling: {
    table: "leveling_settings",
    columns: {
      xpPerMessage: "xp_per_message",
      cooldownSeconds: "cooldown_seconds",
      announceLevelUp: "announce_level_up"
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
  music: {
    table: "music_settings",
    columns: {
      preferredTextChannelId: "preferred_text_channel_id",
      defaultVolume: "default_volume",
      announceTrackStart: "announce_track_start"
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
