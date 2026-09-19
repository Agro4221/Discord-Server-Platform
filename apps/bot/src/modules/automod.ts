import { PermissionFlagsBits, type ChatInputCommandInteraction, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import type { AuditLog } from "../audit.js";
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
  private inspectedMessages = 0;
  private auditLog?: AuditLog;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.auditLog = context.auditLog;
    const a = context.events.on("message.create", (message) => this.inspect(message));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.recent.clear();
    this.inspectedMessages = 0;
    this.auditLog = undefined;
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
       (guild_id,enabled,blocked_words,max_mentions,max_caps_ratio,max_repeated_messages,
        repeated_window_seconds,block_links,block_invites,max_links,max_emojis,max_line_length,
        exempt_channel_ids,exempt_role_ids,delete_message,timeout_minutes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
              repeated_window_seconds,block_links,block_invites,max_links,max_emojis,
              max_line_length,exempt_channel_ids,exempt_role_ids,delete_message,timeout_minutes
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
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const bucket = this.recent.get(key) ?? [];
    const cutoff = now - config.repeatedWindowSeconds * 1000;
    const recent = bucket
      .filter((item) => item.timestamp >= cutoff)
      .slice(-19);

    recent.push({ content: content.toLocaleLowerCase(), timestamp: now });
    this.recent.set(key, recent);
    this.inspectedMessages += 1;
    if (this.inspectedMessages % 100 === 0) this.pruneRecent(now);

    const reason = detectAutoModViolation(
      content,
      mentions,
      config,
      recent.map((item) => item.content)
    );

    if (!reason) return;

    logger.info("AutoMod violation", {
      guildId: message.guild.id,
      userId: message.author.id,
      reason,
      messageId: message.id
    });

    let deleted = false;
    if (config.deleteMessage) {
      try {
        await message.delete();
        deleted = true;
      } catch (error) {
        logger.warn("AutoMod message deletion failed", {
          guildId: message.guild!.id,
          userId: message.author.id,
          messageId: message.id,
          rule: reason,
          error: String(error)
        });
      }
    }

    let timedOut = false;
    if (config.timeoutMinutes > 0 && message.member?.moderatable) {
      try {
        await message.member.timeout(config.timeoutMinutes * 60_000, `AutoMod: ${reason}`);
        timedOut = true;
      } catch (error) {
        logger.warn("AutoMod timeout failed", {
          guildId: message.guild!.id,
          userId: message.author.id,
          messageId: message.id,
          rule: reason,
          timeoutMinutes: config.timeoutMinutes,
          error: String(error)
        });
      }
    }

    await this.db.query(
      `INSERT INTO automod_events(guild_id,user_id,message_id,rule,created_at)
       VALUES($1,$2,$3,$4,now())`,
      [message.guild.id, message.author.id, message.id, reason]
    ).catch((error) => {
      logger.error("AutoMod violation persistence failed", {
        guildId: message.guild!.id,
        userId: message.author.id,
        messageId: message.id,
        rule: reason,
        error: String(error)
      });
    });

    await this.auditLog?.record({
      guildId: message.guild.id,
      source: "system",
      action: "automod.violation",
      targetType: "user",
      targetId: message.author.id,
      metadata: {
        messageId: message.id,
        rule: reason,
        deleted,
        timedOut
      }
    }).catch((error) => {
      logger.warn("AutoMod audit write failed", {
        guildId: message.guild!.id,
        userId: message.author.id,
        messageId: message.id,
        rule: reason,
        error: String(error)
      });
    });
  }

  private pruneRecent(now: number): void {
    const cutoff = now - 120_000;
    for (const [key, entries] of this.recent) {
      const latest = entries.at(-1)?.timestamp ?? 0;
      if (latest < cutoff) this.recent.delete(key);
    }

    const maxKeys = 10_000;
    if (this.recent.size <= maxKeys) return;

    const oldest = [...this.recent.entries()]
      .sort((a, b) => (a[1].at(-1)?.timestamp ?? 0) - (b[1].at(-1)?.timestamp ?? 0))
      .slice(0, this.recent.size - maxKeys);

    for (const [key] of oldest) this.recent.delete(key);
    logger.warn("AutoMod recent-message cache trimmed", {
      removed: oldest.length,
      remaining: this.recent.size
    });
  }
}




export function detectAutoModViolation(
  content: string,
  mentionCount: number,
  config: AutoModConfig,
  recentMessages: readonly string[] = []
): string | null {
  const normalized = content.toLocaleLowerCase();

  if (config.blockedWords.some((word) => word && normalized.includes(word.toLocaleLowerCase()))) {
    return "blocked_word";
  }

  if (mentionCount > config.maxMentions) return "mention_spam";

  const links = content.match(/https?:\/\/[^\s<>]+/gi) ?? [];
  const invites = content.match(/(?:discord(?:\.gg|(?:app)?\.com\/invite))\/[A-Za-z0-9-]+/gi) ?? [];
  if (config.blockInvites && invites.length > 0) return "invite_link";
  if (config.blockLinks && links.length > 0) return "link_blocked";
  if (config.maxLinks > 0 && links.length > config.maxLinks) return "link_spam";

  const emojiMatches = content.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) ?? [];
  if (config.maxEmojis > 0 && emojiMatches.length > config.maxEmojis) return "emoji_spam";

  const longestLine = Math.max(0, ...content.split(/\r?\n/).map((line) => line.length));
  if (config.maxLineLength > 0 && longestLine > config.maxLineLength) return "line_too_long";

  const letters = content.match(/[A-Za-zА-Яа-я]/g) ?? [];
  const upper = content.match(/[A-ZА-Я]/g) ?? [];
  if (letters.length >= 12 && upper.length / letters.length >= config.maxCapsRatio) {
    return "excessive_caps";
  }

  if (recentMessages.filter((item) => item === normalized).length >= config.maxRepeatedMessages) {
    return "repeated_message";
  }

  return null;
}
