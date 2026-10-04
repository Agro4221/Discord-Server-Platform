import type { Database } from "./database.js";

export type Locale = "ru" | "en";

const MESSAGES = {
  "internal-error": {
    ru: "Произошла внутренняя ошибка.",
    en: "An internal error occurred."
  },
  "help-page-missing": {
    ru: "Страница помощи не найдена.",
    en: "Help page not found."
  },
  "help-title": {
    ru: "Vexa — команды",
    en: "Vexa — commands"
  },
  "help-empty": {
    ru: "Нет доступных slash-команд.",
    en: "No slash commands are available."
  },
  "custom-commands-title": {
    ru: "Custom Commands",
    en: "Custom Commands"
  },
  "embed-permission": {
    ru: "Нужны права Manage Server и серверный канал.",
    en: "Manage Server permission and a guild channel are required."
  },
  "embed-empty": {
    ru: "Укажи хотя бы title, description, footer, image или thumbnail.",
    en: "Provide at least a title, description, footer, image or thumbnail."
  },
  "url-http": {
    ru: "URL должен начинаться с http:// или https://.",
    en: "The URL must start with http:// or https://."
  },
  "color-format": {
    ru: "Color укажи в формате #RRGGBB.",
    en: "Color must use the #RRGGBB format."
  },
  "channel-send-unsupported": {
    ru: "Текущий канал не поддерживает отправку сообщений.",
    en: "The current channel does not support sending messages."
  },
  "embed-published": {
    ru: "✅ Embed опубликован.",
    en: "✅ Embed published."
  },
  "role-missing": {
    ru: "Роль не найдена.",
    en: "Role not found."
  }
} as const;

export type MessageKey = keyof typeof MESSAGES;

export function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "ru";
}

export function t(locale: Locale, key: MessageKey): string {
  return MESSAGES[key][locale];
}

export async function getGuildLocale(db: Database, guildId: string): Promise<Locale> {
  const result = await db.query<{ locale: string }>(
    "SELECT locale FROM guild_settings WHERE guild_id=$1",
    [guildId]
  );
  return normalizeLocale(result.rows[0]?.locale);
}
