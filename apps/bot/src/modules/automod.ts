import { PermissionFlagsBits, type ChatInputCommandInteraction, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import type { PlatformEventBus } from "../events.js";
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
  private events?: PlatformEventBus;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.auditLog = context.auditLog;
    this.events = context.events;
    const a = context.events.on("message.create", (message) => this.inspect(message));
    const b = context.events.on("interaction.command", (interaction) => this.executeSlashCommand(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async handlePrefixCommand(message: import("discord.js").Message, commandName: string, args: string[]): Promise<boolean> {
    if (commandName !== "automod") return false;
    if (!message.guild) return false;

    const sub = (args.shift() ?? "setup").toLowerCase();
    if (sub !== "setup") {
      await message.reply("Использование: !automod setup [--words=слово1,слово2] [--mentions=6] [--caps=0.85] [--repeats=5] [--window=10] [--delete|--no-delete] [--timeout=0]");
      return true;
    }

    const values = new Map<string, string>();
    let deleteMessage: boolean | undefined;
    for (const token of args) {
      const match = /^--([a-z-]+)=(.+)$/i.exec(token);
      if (match) values.set(match[1]!.toLowerCase(), match[2]!);
      else if (token.toLowerCase() === "--delete") deleteMessage = true;
      else if (token.toLowerCase() === "--no-delete") deleteMessage = false;
    }

    const blocked = values.get("words");
    const maxMentions = values.get("mentions");
    const capsRatio = values.get("caps");
    const repeats = values.get("repeats");
    const window = values.get("window");
    const timeout = values.get("timeout");

    const patch: Partial<AutoModConfig> = { enabled: true };
    if (blocked !== undefined) patch.blockedWords = blocked.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 500);
    if (maxMentions !== undefined && Number.isFinite(Number(maxMentions))) patch.maxMentions = Number(maxMentions);
    if (capsRatio !== undefined && Number.isFinite(Number(capsRatio))) patch.maxCapsRatio = Number(capsRatio);
    if (repeats !== undefined && Number.isFinite(Number(repeats))) patch.maxRepeatedMessages = Number(repeats);
    if (window !== undefined && Number.isFinite(Number(window))) patch.repeatedWindowSeconds = Number(window);
    if (timeout !== undefined && Number.isFinite(Number(timeout))) patch.timeoutMinutes = Number(timeout);
    if (deleteMessage !== undefined) patch.deleteMessage = deleteMessage;

    await this.configure(message.guild.id, patch);
    await message.reply("AutoMod настроен и включён.");
    return true;
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.recent.clear();
    this.inspectedMessages = 0;
    this.auditLog = undefined;
    this.events = undefined;
  }

  async executeSlashCommand(interaction: ChatInputCommandInteraction, commandName = interaction.commandName): Promise<void> {
    if (!interaction.inGuild() || commandName !== "automod") return;
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

  async listRules(guildId: string): Promise<Array<{
    id: number;
    detector: string;
    enabled: boolean;
    threshold: number | null;
    windowSeconds: number | null;
    action: "delete" | "timeout" | "warn" | "log";
    timeoutMinutes: number;
    affectedRoleIds: string[];
    ignoredRoleIds: string[];
    affectedChannelIds: string[];
    ignoredChannelIds: string[];
    ignoreModerators: boolean;
    logChannelId: string | null;
    messageTemplate: string;
  }>> {
    const result = await this.db.query<{
      id: string;
      detector: string;
      enabled: boolean;
      threshold: string | number | null;
      window_seconds: number | null;
      action: "delete" | "timeout" | "warn" | "log";
      timeout_minutes: number;
      affected_role_ids: string[];
      ignored_role_ids: string[];
      affected_channel_ids: string[];
      ignored_channel_ids: string[];
      ignore_moderators: boolean;
      log_channel_id: string | null;
      message_template: string;
    }>(
      "SELECT id,detector,enabled,threshold,window_seconds,action,timeout_minutes,affected_role_ids,ignored_role_ids,affected_channel_ids,ignored_channel_ids,ignore_moderators,log_channel_id,message_template FROM automod_rules WHERE guild_id=$1 ORDER BY detector",
      [guildId]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      detector: row.detector,
      enabled: row.enabled,
      threshold: row.threshold === null ? null : Number(row.threshold),
      windowSeconds: row.window_seconds,
      action: row.action,
      timeoutMinutes: row.timeout_minutes,
      affectedRoleIds: row.affected_role_ids ?? [],
      ignoredRoleIds: row.ignored_role_ids ?? [],
      affectedChannelIds: row.affected_channel_ids ?? [],
      ignoredChannelIds: row.ignored_channel_ids ?? [],
      ignoreModerators: row.ignore_moderators,
      logChannelId: row.log_channel_id ?? null,
      messageTemplate: row.message_template
    }));
  }

  async upsertRule(
    guildId: string,
    input: {
      detector: string;
      enabled?: boolean;
      threshold?: number | null;
      windowSeconds?: number | null;
      action?: "delete" | "timeout" | "warn" | "log";
      timeoutMinutes?: number;
      affectedRoleIds?: string[];
      ignoredRoleIds?: string[];
      affectedChannelIds?: string[];
      ignoredChannelIds?: string[];
      ignoreModerators?: boolean;
      logChannelId?: string | null;
      messageTemplate?: string;
    }
  ): Promise<void> {
    const detector = input.detector.trim().toLowerCase();
    const supported = new Set([
      "bad-words","links","invites","scam","repeated-text","caps","emotes",
      "mentions","zalgo","honeypot","line-length","link-count","mention-count","emoji-count"
    ]);
    if (!supported.has(detector)) throw new Error("unsupported_automod_detector");

    const action = input.action ?? "delete";
    const threshold = input.threshold === undefined || input.threshold === null ? null : Number(input.threshold);
    const windowSeconds = input.windowSeconds === undefined || input.windowSeconds === null ? null : Math.floor(input.windowSeconds);
    const timeoutMinutes = Math.min(Math.max(Math.floor(input.timeoutMinutes ?? 0),0),40320);

    await this.db.query(
      "INSERT INTO automod_rules(guild_id,detector,enabled,threshold,window_seconds,action,timeout_minutes,affected_role_ids,ignored_role_ids,affected_channel_ids,ignored_channel_ids,ignore_moderators,log_channel_id,message_template) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(guild_id,detector) DO UPDATE SET enabled=EXCLUDED.enabled,threshold=EXCLUDED.threshold,window_seconds=EXCLUDED.window_seconds,action=EXCLUDED.action,timeout_minutes=EXCLUDED.timeout_minutes,affected_role_ids=EXCLUDED.affected_role_ids,ignored_role_ids=EXCLUDED.ignored_role_ids,affected_channel_ids=EXCLUDED.affected_channel_ids,ignored_channel_ids=EXCLUDED.ignored_channel_ids,ignore_moderators=EXCLUDED.ignore_moderators,log_channel_id=EXCLUDED.log_channel_id,message_template=EXCLUDED.message_template,updated_at=now()",
      [
        guildId,
        detector,
        input.enabled !== false,
        threshold,
        windowSeconds,
        action,
        timeoutMinutes,
        cleanIds(input.affectedRoleIds),
        cleanIds(input.ignoredRoleIds),
        cleanIds(input.affectedChannelIds),
        cleanIds(input.ignoredChannelIds),
        input.ignoreModerators !== false,
        input.logChannelId ?? null,
        (input.messageTemplate ?? "").slice(0,1000)
      ]
    );

    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'automod',true) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()",
      [guildId]
    );
  }

  async deleteRule(guildId: string, id: number): Promise<boolean> {
    const result = await this.db.query("DELETE FROM automod_rules WHERE guild_id=$1 AND id=$2", [guildId,id]);
    return result.rowCount === 1;
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

    const exemptChannels = new Set(config.exemptChannelIds.split(/[\s,\n]+/).map((id) => id.trim()).filter(Boolean));
    if (exemptChannels.has(message.channelId)) return;

    const exemptRoles = new Set(config.exemptRoleIds.split(/[\s,\n]+/).map((id) => id.trim()).filter(Boolean));
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

    if (reason) {
      await this.applyBaseViolation(message, reason, config);
      return;
    }

    const rules = await this.db.query<{
      detector: string;
      threshold: number | string | null;
      window_seconds: number | null;
      action: "delete" | "timeout" | "warn" | "log";
      timeout_minutes: number;
      affected_role_ids: string[];
      ignored_role_ids: string[];
      affected_channel_ids: string[];
      ignored_channel_ids: string[];
      ignore_moderators: boolean;
      log_channel_id: string | null;
      message_template: string;
    }>(
      "SELECT detector,threshold,window_seconds,action,timeout_minutes,affected_role_ids,ignored_role_ids,affected_channel_ids,ignored_channel_ids,ignore_moderators,log_channel_id,message_template " +
      "FROM automod_rules WHERE guild_id=$1 AND enabled=true ORDER BY id",
      [message.guild.id]
    );

    const roleIds = message.member?.roles.cache.map((role) => role.id) ?? [];

    for (const rule of rules.rows) {
      if (rule.ignored_channel_ids?.includes(message.channelId)) continue;
      if (rule.detector === "honeypot" && !rule.affected_channel_ids?.includes(message.channelId)) continue;
      if (rule.affected_channel_ids?.length && !rule.affected_channel_ids.includes(message.channelId)) continue;
      if (rule.ignored_role_ids?.some((id) => roleIds.includes(id))) continue;
      if (rule.affected_role_ids?.length && !rule.affected_role_ids.some((id) => roleIds.includes(id))) continue;

      if (
        rule.ignore_moderators &&
        message.member?.permissions.has(PermissionFlagsBits.ManageMessages)
      ) continue;

      const normalizedRule = {
        detector: rule.detector,
        threshold: rule.threshold === null ? null : Number(rule.threshold),
        windowSeconds: rule.window_seconds
      };

      if (!detectorMatches(
        normalizedRule,
        message,
        recent.map((item) => item.content),
        config
      )) {
        continue;
      }

      await this.applyRule(message, {
        detector: rule.detector,
        action: rule.action,
        timeoutMinutes: rule.timeout_minutes,
        logChannelId: rule.log_channel_id ?? null,
        messageTemplate: rule.message_template
      });
      return;
    }

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

    const auditLog = this.auditLog;
    if (auditLog) {
      try {
        await auditLog.record({
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
        });
      } catch (error) {
        logger.warn("AutoMod audit write failed", {
          guildId: message.guild!.id,
          userId: message.author.id,
          messageId: message.id,
          rule: reason,
          error: String(error)
        });
      }
    }
  }

  private async applyBaseViolation(
    message: Message,
    reason: string,
    config: AutoModConfig
  ): Promise<void> {
    let deleted = false;
    if (config.deleteMessage) {
      await message.delete().then(() => { deleted = true; }).catch(() => undefined);
    }

    let timedOut = false;
    if (config.timeoutMinutes > 0 && message.member?.moderatable) {
      await message.member
        .timeout(config.timeoutMinutes * 60_000, "AutoMod: " + reason)
        .then(() => { timedOut = true; })
        .catch(() => undefined);
    }

    await this.db.query(
      "INSERT INTO automod_events(guild_id,user_id,message_id,rule,created_at) VALUES($1,$2,$3,$4,now())",
      [message.guild!.id, message.author.id, message.id, reason]
    ).catch(() => undefined);

    await this.auditLog?.record({
      guildId: message.guild!.id,
      source: "system",
      action: "automod.violation",
      targetType: "user",
      targetId: message.author.id,
      metadata: { messageId: message.id, rule: reason, deleted, timedOut }
    }).catch(() => undefined);
  }

  private async applyRule(
    message: Message,
    rule: {
      detector: string;
      action: "delete" | "timeout" | "warn" | "log";
      timeoutMinutes: number;
      logChannelId: string | null;
      messageTemplate: string;
    }
  ): Promise<boolean> {
    let deleted = false;
    if (rule.action === "delete" || rule.action === "timeout" || rule.action === "warn") {
      try {
        await message.delete();
        deleted = true;
      } catch (error) {
        logger.warn("AutoMod rule message deletion failed", {
          guildId: message.guild!.id,
          userId: message.author.id,
          messageId: message.id,
          detector: rule.detector,
          error: String(error)
        });
      }
    }

    if ((rule.action === "timeout" || rule.action === "warn") && rule.timeoutMinutes > 0 && message.member?.moderatable) {
      await message.member.timeout(rule.timeoutMinutes * 60_000, "AutoMod: " + rule.detector).catch((error) =>
        logger.warn("AutoMod rule timeout failed", { guildId:message.guild!.id,userId:message.author.id,detector:rule.detector,error:String(error) })
      );
    }

    await this.db.query(
      "INSERT INTO automod_events(guild_id,user_id,message_id,rule,created_at) VALUES($1,$2,$3,$4,now())",
      [message.guild!.id,message.author.id,message.id,rule.detector]
    ).catch(() => undefined);

    if (rule.action === "warn") {
      const warnResult = await this.db.query<{ id: string }>(
        "INSERT INTO moderation_cases(guild_id,target_user_id,moderator_user_id,action,reason,created_at) VALUES($1,$2,'system','warn',$3,now()) RETURNING id",
        [message.guild!.id, message.author.id, "AutoMod: " + rule.detector]
      ).catch(() => null);

      const caseId = warnResult?.rows[0]?.id;
      if (caseId) {
        await this.events?.emit("moderation.case", {
          guildId: message.guild!.id,
          userId: message.author.id,
          action: "warn",
          caseId: Number(caseId)
        }).catch(() => undefined);
      }
    }

    await this.auditLog?.record({
      guildId: message.guild!.id,
      source: "system",
      action: "automod.rule.triggered",
      targetType: "user",
      targetId: message.author.id,
      metadata: { detector: rule.detector, action: rule.action, deleted }
    }).catch(() => undefined);

    let logDelivered = false;
    if (rule.action === "log" && rule.logChannelId) {
      const logChannel = message.guild!.channels.cache.get(rule.logChannelId);
      if (logChannel?.isTextBased() && "send" in logChannel) {
        const rendered = (rule.messageTemplate || (
          "⚠️ AutoMod: **" + rule.detector + "** triggered for <@" + message.author.id + "> in <#" + message.channelId + "> (message " + message.id + ")."
        ))
          .replaceAll("{mention}", "<@" + message.author.id + ">")
          .replaceAll("{user}", message.author.username)
          .replaceAll("{channel}", "<#" + message.channelId + ">");
        await logChannel.send({
          content: rendered,
          allowedMentions: { users: [message.author.id], roles: [], repliedUser: false }
        }).then(() => { logDelivered = true; }).catch((error) => {
          logger.warn("AutoMod log delivery failed", {
            guildId: message.guild!.id,
            userId: message.author.id,
            messageId: message.id,
            detector: rule.detector,
            logChannelId: rule.logChannelId,
            error: String(error)
          });
        });
      }
    }

    if (rule.messageTemplate && rule.action !== "log") {
      const rendered = rule.messageTemplate
        .replaceAll("{mention}", "<@" + message.author.id + ">")
        .replaceAll("{user}", message.author.username)
        .replaceAll("{channel}", "<#" + message.channelId + ">");
      if ("send" in message.channel) {
        await message.channel.send({
          content: rendered,
          allowedMentions: { users: [message.author.id], roles: [], repliedUser: false }
        }).catch((error) => {
          logger.warn("AutoMod response delivery failed", {
            guildId: message.guild!.id,
            userId: message.author.id,
            messageId: message.id,
            detector: rule.detector,
            error: String(error)
          });
        });
      }
    }

    await this.auditLog?.record({
      guildId: message.guild!.id,
      source: "system",
      action: "automod.rule.triggered",
      targetType: "user",
      targetId: message.author.id,
      metadata: { detector: rule.detector, action: rule.action, deleted, logDelivered }
    }).catch(() => undefined);

    return true;
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



function cleanIds(values?: string[]): string[] {
  return [...new Set((values ?? []).filter((value) => /^\d{15,25}$/.test(value)))].slice(0,100);
}

function detectorMatches(
  rule: { detector: string; threshold: number | null; windowSeconds: number | null },
  message: Message,
  recentMessages: readonly string[] = [],
  config?: AutoModConfig
): boolean {
  const content = message.content;
  const normalized = content.toLocaleLowerCase();
  switch (rule.detector) {
    case "bad-words":
      return Boolean(config?.blockedWords.some((word) => word && normalized.includes(word.toLocaleLowerCase())));
    case "links":
      return /https?:\/\/[^\s<>]+/i.test(content);
    case "invites":
      return /discord(?:\.gg|(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i.test(content);
    case "scam":
      return /(free\s+nitro|claim\s+nitro|steamcommunity-?gift|discord\s+gift)/i.test(content);
    case "caps": {
      const letters = content.match(/[A-Za-zА-Яа-я]/g) ?? [];
      const upper = content.match(/[A-ZА-Я]/g) ?? [];
      const ratio = letters.length ? upper.length / letters.length : 0;
      return letters.length >= 12 && ratio >= Number(rule.threshold ?? 0.85);
    }
    case "mentions":
      return (message.mentions.users.size + message.mentions.roles.size) > Number(rule.threshold ?? 6);
    case "mention-count":
      return (message.mentions.users.size + message.mentions.roles.size) > Number(rule.threshold ?? 6);
    case "emoji-count":
    case "emotes":
      return ((content.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) ?? []).length) > Number(rule.threshold ?? 20);
    case "line-length":
      return Math.max(0,...content.split(/\r?\n/).map((line) => line.length)) > Number(rule.threshold ?? 1000);
    case "link-count":
      return (content.match(/https?:\/\/[^\s<>]+/gi) ?? []).length > Number(rule.threshold ?? 3);
    case "zalgo":
      return /[\u0300-\u036f]{4,}/u.test(content);
    case "honeypot":
      return true;
    case "repeated-text": {
      const normalizedRecent = recentMessages.filter((item) => item === normalized);
      return normalizedRecent.length >= Number(rule.threshold ?? 5);
    }
    default:
      return normalized.length > 0 && rule.detector === "content";
  }
}

export function parseAutoModIdList(value: string): Set<string> {
  return new Set(value.split(/[\s,\n]+/).map((id) => id.trim()).filter(Boolean));
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
