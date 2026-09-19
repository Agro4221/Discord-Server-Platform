import { PermissionFlagsBits, type ChatInputCommandInteraction, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type AutoModConfig = {
  enabled: boolean;
  blockedWords: string[];
  maxMentions: number;
  maxCapsRatio: number;
  maxRepeatedMessages: number;
  repeatedWindowSeconds: number;
  deleteMessage: boolean;
  timeoutMinutes: number;
};

const defaultConfig: AutoModConfig = {
  enabled: true,
  blockedWords: [],
  maxMentions: 6,
  maxCapsRatio: 0.85,
  maxRepeatedMessages: 5,
  repeatedWindowSeconds: 10,
  deleteMessage: true,
  timeoutMinutes: 0
};

export class AutoMod implements PlatformModule {
  readonly name = "automod";
  private unsubscribe?: () => void;
  private readonly recent = new Map<string, { content: string; timestamp: number }[]>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("message.create", (message) => this.inspect(message));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.recent.clear();
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "automod") return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() !== "setup") return;

    const blocked = interaction.options.getString("blocked-words");
    await this.configure(interaction.guild.id, {
      enabled: true,
      blockedWords: blocked ? blocked.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 500) : undefined,
      maxMentions: interaction.options.getInteger("max-mentions") ?? 6,
      maxCapsRatio: interaction.options.getNumber("caps-ratio") ?? 0.85,
      maxRepeatedMessages: interaction.options.getInteger("repeats") ?? 5,
      repeatedWindowSeconds: interaction.options.getInteger("window") ?? 10,
      deleteMessage: interaction.options.getBoolean("delete") ?? true,
      timeoutMinutes: interaction.options.getInteger("timeout") ?? 0
    });

    await interaction.reply({ content: "AutoMod настроен и включён.", ephemeral: true });
  }

  async configure(guildId: string, patch: Partial<AutoModConfig>): Promise<void>
    const current = await this.getConfig(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO automod_settings
       (guild_id,enabled,blocked_words,max_mentions,max_caps_ratio,max_repeated_messages,repeated_window_seconds,delete_message,timeout_minutes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(guild_id) DO UPDATE SET
       enabled=EXCLUDED.enabled,blocked_words=EXCLUDED.blocked_words,
       max_mentions=EXCLUDED.max_mentions,max_caps_ratio=EXCLUDED.max_caps_ratio,
       max_repeated_messages=EXCLUDED.max_repeated_messages,
       repeated_window_seconds=EXCLUDED.repeated_window_seconds,
       delete_message=EXCLUDED.delete_message,timeout_minutes=EXCLUDED.timeout_minutes,
       updated_at=now()`,
      [
        guildId,
        next.enabled,
        next.blockedWords,
        next.maxMentions,
        next.maxCapsRatio,
        next.maxRepeatedMessages,
        next.repeatedWindowSeconds,
        next.deleteMessage,
        next.timeoutMinutes
      ]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'automod',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId, next.enabled]
    );
  }

  async getConfig(guildId: string): Promise<AutoModConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      blocked_words: string[] | null;
      max_mentions: number;
      max_caps_ratio: number;
      max_repeated_messages: number;
      repeated_window_seconds: number;
      delete_message: boolean;
      timeout_minutes: number;
    }>(
      `SELECT enabled,blocked_words,max_mentions,max_caps_ratio,max_repeated_messages,
              repeated_window_seconds,delete_message,timeout_minutes
       FROM automod_settings WHERE guild_id=$1`,
      [guildId]
    );
    const row = result.rows[0];
    if (!row) return defaultConfig;

    return {
      enabled: row.enabled,
      blockedWords: row.blocked_words ?? [],
      maxMentions: row.max_mentions,
      maxCapsRatio: row.max_caps_ratio,
      maxRepeatedMessages: row.max_repeated_messages,
      repeatedWindowSeconds: row.repeated_window_seconds,
      deleteMessage: row.delete_message,
      timeoutMinutes: row.timeout_minutes
    };
  }

  private async inspect(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "automod", false)) return;

    const config = await this.getConfig(message.guild.id);
    if (!config.enabled) return;
    const content = message.content;
    const normalized = content.toLocaleLowerCase();

    let reason: string | null = null;

    if (config.blockedWords.some((word) => word && normalized.includes(word.toLocaleLowerCase()))) {
      reason = "blocked_word";
    }

    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (!reason && mentions > config.maxMentions) reason = "mention_spam";

    const letters = content.match(/[A-Za-zА-Яа-я]/g) ?? [];
    const upper = content.match(/[A-ZА-Я]/g) ?? [];
    if (!reason && letters.length >= 12 && upper.length / letters.length >= config.maxCapsRatio) {
      reason = "excessive_caps";
    }

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const bucket = this.recent.get(key) ?? [];
    bucket.push({ content: normalized, timestamp: now });
    const cutoff = now - config.repeatedWindowSeconds * 1000;
    const recent = bucket.filter((item) => item.timestamp >= cutoff).slice(-20);
    this.recent.set(key, recent);

    if (!reason && recent.filter((item) => item.content === normalized).length >= config.maxRepeatedMessages) {
      reason = "repeated_message";
    }

    if (!reason) return;

    logger.info("AutoMod violation", {
      guildId: message.guild.id,
      userId: message.author.id,
      reason,
      messageId: message.id
    });

    if (config.deleteMessage) {
      await message.delete("AutoMod violation").catch(() => undefined);
    }

    if (config.timeoutMinutes > 0 && message.member?.moderatable) {
      await message.member.timeout(config.timeoutMinutes * 60_000, `AutoMod: ${reason}`).catch(() => undefined);
    }

    await this.db.query(
      `INSERT INTO automod_events(guild_id,user_id,message_id,rule,created_at)
       VALUES($1,$2,$3,$4,now())`,
      [message.guild.id, message.author.id, message.id, reason]
    ).catch(() => undefined);
  }
}
