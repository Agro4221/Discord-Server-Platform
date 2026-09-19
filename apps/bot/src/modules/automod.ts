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
  blockLinks: boolean;
  blockInvites: boolean;
  maxLinks: number;
  maxEmojis: number;
  maxLineLength: number;
  exemptChannelIds: string;
  exemptRoleIds: string;
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
  blockLinks: false,
  blockInvites: false,
  maxLinks: 3,
  maxEmojis: 20,
  maxLineLength: 1000,
  exemptChannelIds: "",
  exemptRoleIds: "",
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
    await this.configure(interaction.guild!.id, {
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

  async configure(guildId: string, patch: Partial<AutoModConfig>): Promise<void> {
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
       block_links=EXCLUDED.block_links,
       block_invites=EXCLUDED.block_invites,
       max_links=EXCLUDED.max_links,
       max_emojis=EXCLUDED.max_emojis,
       max_line_length=EXCLUDED.max_line_length,
       exempt_channel_ids=EXCLUDED.exempt_channel_ids,
       exempt_role_ids=EXCLUDED.exempt_role_ids,
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
        next.blockLinks,
        next.blockInvites,
        next.maxLinks,
        next.maxEmojis,
        next.maxLineLength,
        next.exemptChannelIds,
        next.exemptRoleIds,
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
      block_links: boolean;
      block_invites: boolean;
      max_links: number;
      max_emojis: number;
      max_line_length: number;
      exempt_channel_ids: string;
      exempt_role_ids: string;
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
      blockLinks: row.block_links,
      blockInvites: row.block_invites,
      maxLinks: row.max_links,
      maxEmojis: row.max_emojis,
      maxLineLength: row.max_line_length,
      exemptChannelIds: row.exempt_channel_ids ?? "",
      exemptRoleIds: row.exempt_role_ids ?? "",
      deleteMessage: row.delete_message,
      timeoutMinutes: row.timeout_minutes
    };
  }

  private async inspect(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "automod", false)) return;

    const config = await this.getConfig(message.guild.id);
    if (!config.enabled) return;

    const exemptChannels = new Set(config.exemptChannelIds.split(/[\\s,\\n]+/).map((id) => id.trim()).filter(Boolean));
    if (exemptChannels.has(message.channelId)) return;

    const exemptRoles = new Set(config.exemptRoleIds.split(/[\\s,\\n]+/).map((id) => id.trim()).filter(Boolean));
    if (message.member && [...exemptRoles].some((roleId) => message.member!.roles.cache.has(roleId))) return;

    const content = message.content;
    const normalized = content.toLocaleLowerCase();

    let reason: string | null = null;

    if (config.blockedWords.some((word) => word && normalized.includes(word.toLocaleLowerCase()))) {
      reason = "blocked_word";
    }

    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (!reason && mentions > config.maxMentions) reason = "mention_spam";

    const links = content.match(/https?:\/\/[^\s<>]+/gi) ?? [];
    const invites = content.match(/(?:discord(?:\.gg|(?:app)?\.com\/invite))\/[A-Za-z0-9-]+/gi) ?? [];
    if (!reason && config.blockInvites && invites.length > 0) reason = "invite_link";
    if (!reason && config.blockLinks && links.length > 0) reason = "link_blocked";
    if (!reason && config.maxLinks > 0 && links.length > config.maxLinks) reason = "link_spam";

    const emojiMatches = content.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) ?? [];
    if (!reason && config.maxEmojis > 0 && emojiMatches.length > config.maxEmojis) reason = "emoji_spam";

    const longestLine = Math.max(0, ...content.split(/\r?\n/).map((line) => line.length));
    if (!reason && config.maxLineLength > 0 && longestLine > config.maxLineLength) reason = "line_too_long";

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
      await message.delete().catch(() => undefined);
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
