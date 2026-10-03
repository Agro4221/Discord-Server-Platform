import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message,
  type User
} from "discord.js";
import type { Database } from "../database.js";
import type { PlatformModule, ModuleContext } from "../module.js";
import { logger } from "../logger.js";
import type { AuditLog } from "../audit.js";
import type { PlatformEventBus } from "../events.js";

type ModerationAction = "warn" | "timeout" | "kick" | "ban" | "unban";

export type ModerationCase = {
  id: number;
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  action: ModerationAction;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export class Moderation implements PlatformModule {
  readonly name = "moderation";
  private events?: PlatformEventBus;
  private auditLog?: AuditLog;
  private client?: ModuleContext["client"];
  private identityId = "primary";
  private expiryTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.events = context.events;
    this.auditLog = context.auditLog;
    this.client = context.client;
    this.identityId = context.identityId;

    this.expiryTimer = setInterval(() => {
      void this.processExpiredTimedPunishments();
    }, 30_000);
    this.expiryTimer.unref();
    this.cleanupTimer = setInterval(() => {
      void this.processScheduledCleanup();
    }, 60_000);
    this.cleanupTimer.unref();
  }

  async shutdown(): Promise<void> {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.events = undefined;
    this.auditLog = undefined;
    this.client = undefined;
  }

  async record(
    guildId: string,
    targetUserId: string,
    moderatorUserId: string,
    action: ModerationAction,
    reason: string | null,
    expiresAt: Date | null = null
  ): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO moderation_cases
        (guild_id,target_user_id,moderator_user_id,action,reason,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [guildId, targetUserId, moderatorUserId, action, reason, expiresAt]
    );
    const caseId = Number(result.rows[0]?.id);
    if (Number.isSafeInteger(caseId) && caseId > 0) {
      await this.events?.emit("moderation.case", {
        guildId,
        userId: targetUserId,
        action,
        caseId,
        moderatorUserId,
        reason: reason ?? undefined
      });
    }
    return caseId;
  }

  async history(guildId: string, targetUserId: string, limit = 10): Promise<ModerationCase[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      target_user_id: string;
      moderator_user_id: string;
      action: ModerationAction;
      reason: string | null;
      expires_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id,guild_id,target_user_id,moderator_user_id,action,reason,expires_at,created_at
       FROM moderation_cases
       WHERE guild_id=$1 AND target_user_id=$2
       ORDER BY created_at DESC
       LIMIT $3`,
      [guildId, targetUserId, safeLimit]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      targetUserId: row.target_user_id,
      moderatorUserId: row.moderator_user_id,
      action: row.action,
      reason: row.reason,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }));
  }

  async addNote(guildId: string, targetUserId: string, moderatorUserId: string, note: string): Promise<number> {
    const clean = note.trim().slice(0, 1000);
    if (!clean) throw new Error("moderation_note_empty");
    const result = await this.db.query<{ id: string }>(
      "INSERT INTO moderation_notes(guild_id,target_user_id,moderator_user_id,note) VALUES($1,$2,$3,$4) RETURNING id",
      [guildId,targetUserId,moderatorUserId,clean]
    );
    return Number(result.rows[0]?.id ?? 0);
  }

  async notes(guildId: string, targetUserId: string, limit = 10): Promise<Array<{
    id: number;
    targetUserId: string;
    moderatorUserId: string;
    note: string;
    createdAt: Date;
  }>> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const result = await this.db.query<{
      id: string;
      target_user_id: string;
      moderator_user_id: string;
      note: string;
      created_at: Date;
    }>(
      `SELECT id,target_user_id,moderator_user_id,note,created_at
       FROM moderation_notes
       WHERE guild_id=$1 AND target_user_id=$2
       ORDER BY created_at DESC
       LIMIT $3`,
      [guildId,targetUserId,safeLimit]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      targetUserId: row.target_user_id,
      moderatorUserId: row.moderator_user_id,
      note: row.note,
      createdAt: row.created_at
    }));
  }

  private async enabled(guildId: string): Promise<boolean> {
    const result = await this.db.query<{ enabled: boolean }>(
      "SELECT enabled FROM guild_modules WHERE guild_id=$1 AND module_key='moderation'",
      [guildId]
    );
    return result.rows[0]?.enabled ?? true;
  }

  async dashboardAction(
    guildId: string,
    targetUserId: string,
    action: ModerationAction,
    reason: string,
    durationMinutes?: number,
    actorUserId = "dashboard"
  ): Promise<{ caseId: number | null; action: ModerationAction; targetUserId: string }> {
    if (!await this.enabled(guildId)) throw new Error("moderation_disabled");

    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) throw new Error("guild_not_found");
    const targetUser = await this.client?.users.fetch(targetUserId).catch(() => null);
    if (!targetUser) throw new Error("user_not_found");

    const member = action === "unban"
      ? null
      : await guild.members.fetch(targetUserId).catch(() => null);

    if (action === "warn") {
      await this.applyWarn(guildId, actorUserId, targetUser, reason || "Без причины");
      return { caseId: await this.latestCaseId(guildId, targetUserId, "warn"), action, targetUserId };
    }

    if (action === "unban") {
      await guild.members.unban(targetUserId, reason || "Без причины");
      const caseId = await this.recordBestEffort(guildId, targetUserId, actorUserId, "unban", reason || "Без причины");
      await this.audit("moderation.unban.applied", guildId, actorUserId, targetUserId, { reason: reason || "Без причины" });
      return { caseId, action, targetUserId };
    }

    if (!member) throw new Error("member_not_found");

    if (action === "kick") {
      if (!member.kickable) throw new Error("member_not_kickable");
      await member.kick(reason || "Без причины");
      await this.audit("moderation.kick.applied", guildId, actorUserId, targetUserId, { reason: reason || "Без причины" });
      const caseId = await this.recordBestEffort(guildId, targetUserId, actorUserId, "kick", reason || "Без причины");
      return { caseId, action, targetUserId };
    }

    if (action === "timeout") {
      if (!member.moderatable) throw new Error("member_not_timeoutable");
      if (!durationMinutes || durationMinutes < 1 || durationMinutes > 40320) throw new Error("invalid_timeout_duration");
      const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
      await member.timeout(durationMinutes * 60_000, reason || "Без причины");
      await this.audit("moderation.timeout.applied", guildId, actorUserId, targetUserId, { durationMinutes, reason: reason || "Без причины" });
      const caseId = await this.recordBestEffort(guildId, targetUserId, actorUserId, "timeout", reason || "Без причины", expiresAt);
      return { caseId, action, targetUserId };
    }

    if (!member.bannable) throw new Error("member_not_bannable");
    const expiresAt = durationMinutes && durationMinutes > 0
      ? new Date(Date.now() + durationMinutes * 60_000)
      : null;
    if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 40320)) {
      throw new Error("invalid_ban_duration");
    }
    await member.ban({ reason: reason || "Без причины" });
    await this.audit("moderation.ban.applied", guildId, actorUserId, targetUserId, {
      reason: reason || "Без причины",
      ...(expiresAt ? { durationMinutes } : {})
    });
    const caseId = await this.recordBestEffort(guildId, targetUserId, actorUserId, "ban", reason || "Без причины", expiresAt);
    return { caseId, action, targetUserId };
  }

  private async latestCaseId(guildId: string, targetUserId: string, action: ModerationAction): Promise<number | null> {
    const result = await this.db.query<{ id: string }>(
      "SELECT id FROM moderation_cases WHERE guild_id=$1 AND target_user_id=$2 AND action=$3 ORDER BY created_at DESC LIMIT 1",
      [guildId, targetUserId, action]
    );
    return result.rows[0] ? Number(result.rows[0].id) : null;
  }

  async listCleanupRules(guildId: string): Promise<Array<{
    id: number;
    channelId: string;
    intervalSeconds: number;
    maxMessages: number;
    enabled: boolean;
    lastRunAt: string | null;
  }>> {
    const result = await this.db.query<{
      id: string;
      channel_id: string;
      interval_seconds: number;
      max_messages: number;
      enabled: boolean;
      last_run_at: string | null;
    }>("SELECT id,channel_id,interval_seconds,max_messages,enabled,last_run_at FROM moderation_cleanup_rules WHERE guild_id=$1 ORDER BY id DESC",[guildId]);
    return result.rows.map((row) => ({
      id: Number(row.id),
      channelId: row.channel_id,
      intervalSeconds: row.interval_seconds,
      maxMessages: row.max_messages,
      enabled: row.enabled,
      lastRunAt: row.last_run_at
    }));
  }

  async saveCleanupRule(guildId: string, channelId: string, intervalSeconds: number, maxMessages: number, enabled = true): Promise<void> {
    if (!/^\d{17,20}$/.test(channelId)) throw new Error("invalid_cleanup_channel");
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 604800) throw new Error("invalid_cleanup_interval");
    if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 100) throw new Error("invalid_cleanup_amount");
    if (!await this.enabled(guildId)) throw new Error("moderation_disabled");
    const guild = this.client?.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased() || !("bulkDelete" in channel)) throw new Error("invalid_cleanup_channel");
    await this.db.query("INSERT INTO moderation_cleanup_rules(guild_id,channel_id,interval_seconds,max_messages,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id,channel_id) DO UPDATE SET interval_seconds=EXCLUDED.interval_seconds,max_messages=EXCLUDED.max_messages,enabled=EXCLUDED.enabled,updated_at=now()",[guildId,channelId,intervalSeconds,maxMessages,enabled]);
  }

  async deleteCleanupRule(guildId: string, id: number): Promise<boolean> {
    const result = await this.db.query("DELETE FROM moderation_cleanup_rules WHERE id=$1 AND guild_id=$2",[id,guildId]);
    return result.rowCount === 1;
  }
  async purge(interaction: ChatInputCommandInteraction, amount: number): Promise<void> {
    if (!interaction.guild || !interaction.channel || !("bulkDelete" in interaction.channel)) {
      await interaction.reply({ content: "Эта команда доступна только в текстовом канале.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: "Недостаточно прав: Manage Messages.", ephemeral: true });
      return;
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      await interaction.reply({ content: "Количество должно быть от 1 до 100.", ephemeral: true });
      return;
    }

    const result = await interaction.channel.bulkDelete(amount, true);
    await this.audit("moderation.purge", interaction.guild.id, interaction.user.id, interaction.channelId, { requested: amount, deleted: result.size });
    await interaction.reply({ content: `🧹 Удалено сообщений: **${result.size}**.`, ephemeral: true });
  }

  async slowmode(interaction: ChatInputCommandInteraction, seconds: number): Promise<void> {
    if (!interaction.guild || !interaction.channel || !("setRateLimitPerUser" in interaction.channel)) {
      await interaction.reply({ content: "Эта команда доступна только в текстовом канале.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Недостаточно прав: Manage Channels.", ephemeral: true });
      return;
    }
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
      await interaction.reply({ content: "Slowmode должен быть 0–21600 секунд.", ephemeral: true });
      return;
    }

    await interaction.channel.setRateLimitPerUser(seconds, "Configured by Vexa");
    await this.audit("moderation.slowmode", interaction.guild.id, interaction.user.id, interaction.channelId, { seconds });
    await interaction.reply({ content: seconds === 0 ? "🐢 Slowmode отключён." : `🐢 Slowmode: **${seconds} сек.**`, ephemeral: true });
  }

  async lockChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.channel;
    if (!interaction.guild || !channel || !("permissionOverwrites" in channel)) {
      await interaction.reply({ content: "Эта команда доступна только в текстовом канале.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Недостаточно прав: Manage Channels.", ephemeral: true });
      return;
    }

    const everyone = interaction.guild.roles.everyone;
    const current = channel.permissionsFor(everyone)?.has(PermissionFlagsBits.SendMessages) ?? null;
    await this.db.query(
      "INSERT INTO moderation_channel_locks(guild_id,channel_id,previous_send_messages) VALUES($1,$2,$3) ON CONFLICT(guild_id,channel_id) DO NOTHING",
      [interaction.guild.id,channel.id,current]
    );
    await channel.permissionOverwrites.edit(everyone,{ SendMessages: false },{ reason: "Vexa channel lock" });
    await this.audit("moderation.channel.lock", interaction.guild.id, interaction.user.id, channel.id, {});
    await interaction.reply({ content: "🔒 Канал заблокирован для @everyone.", ephemeral: true });
  }

  async unlockChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.channel;
    if (!interaction.guild || !channel || !("permissionOverwrites" in channel)) {
      await interaction.reply({ content: "Эта команда доступна только в текстовом канале.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Недостаточно прав: Manage Channels.", ephemeral: true });
      return;
    }

    const stored = await this.db.query<{ previous_send_messages: boolean | null }>(
      "SELECT previous_send_messages FROM moderation_channel_locks WHERE guild_id=$1 AND channel_id=$2",
      [interaction.guild.id,channel.id]
    );
    const previous = stored.rows[0]?.previous_send_messages ?? null;
    await channel.permissionOverwrites.edit(
      interaction.guild.roles.everyone,
      { SendMessages: previous },
      { reason: "Vexa channel unlock" }
    );
    await this.db.query("DELETE FROM moderation_channel_locks WHERE guild_id=$1 AND channel_id=$2",[interaction.guild.id,channel.id]);
    await this.audit("moderation.channel.unlock", interaction.guild.id, interaction.user.id, channel.id, {});
    await interaction.reply({ content: "🔓 Канал разблокирован.", ephemeral: true });
  }

  async purgeFromMessage(message: Message, amount: number): Promise<void> {
    if (!message.guild || !message.channel || !("bulkDelete" in message.channel)) return;
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await message.reply("Недостаточно прав: Manage Messages.");
      return;
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      await message.reply("Количество должно быть от 1 до 100.");
      return;
    }
    const result = await message.channel.bulkDelete(Math.min(100,amount + 1), true);
    await this.audit("moderation.purge", message.guild.id, message.author.id, message.channelId, { requested: amount, deleted: result.size });
  }

  async slowmodeFromMessage(message: Message, seconds: number): Promise<void> {
    if (!message.guild || !message.channel || !("setRateLimitPerUser" in message.channel)) return;
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply("Недостаточно прав: Manage Channels.");
      return;
    }
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
      await message.reply("Slowmode должен быть 0–21600 секунд.");
      return;
    }
    await message.channel.setRateLimitPerUser(seconds,"Configured by Vexa");
    await this.audit("moderation.slowmode", message.guild.id, message.author.id, message.channelId, { seconds });
    await message.reply(seconds === 0 ? "🐢 Slowmode отключён." : `🐢 Slowmode: ${seconds} сек.`);
  }

  async lockChannelFromMessage(message: Message): Promise<void> {
    if (!message.guild || !message.channel || !("permissionOverwrites" in message.channel)) return;
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply("Недостаточно прав: Manage Channels.");
      return;
    }
    const everyone = message.guild.roles.everyone;
    const current = message.channel.permissionsFor(everyone)?.has(PermissionFlagsBits.SendMessages) ?? null;
    await this.db.query(
      "INSERT INTO moderation_channel_locks(guild_id,channel_id,previous_send_messages) VALUES($1,$2,$3) ON CONFLICT(guild_id,channel_id) DO NOTHING",
      [message.guild.id,message.channelId,current]
    );
    await message.channel.permissionOverwrites.edit(everyone,{ SendMessages: false },{ reason: "Vexa channel lock" });
    await this.audit("moderation.channel.lock",message.guild.id,message.author.id,message.channelId,{});
    await message.reply("🔒 Канал заблокирован для @everyone.");
  }

  async unlockChannelFromMessage(message: Message): Promise<void> {
    if (!message.guild || !message.channel || !("permissionOverwrites" in message.channel)) return;
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply("Недостаточно прав: Manage Channels.");
      return;
    }
    const stored = await this.db.query<{ previous_send_messages: boolean | null }>(
      "SELECT previous_send_messages FROM moderation_channel_locks WHERE guild_id=$1 AND channel_id=$2",
      [message.guild.id,message.channelId]
    );
    const previous = stored.rows[0]?.previous_send_messages ?? null;
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone,{ SendMessages: previous },{ reason: "Vexa channel unlock" });
    await this.db.query("DELETE FROM moderation_channel_locks WHERE guild_id=$1 AND channel_id=$2",[message.guild.id,message.channelId]);
    await this.audit("moderation.channel.unlock",message.guild.id,message.author.id,message.channelId,{});
    await message.reply("🔓 Канал разблокирован.");
  }

  async warn(interaction: ChatInputCommandInteraction, target: User, reason: string): Promise<void> {
    if (!interaction.guild || !await this.enabled(interaction.guild.id)) {
      await interaction.reply({ content: "Модуль Moderation выключен для этого сервера.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Moderate Members.", ephemeral: true });
      return;
    }

    await this.applyWarn(interaction.guild.id, interaction.user.id, target, reason);
    await interaction.reply({
      content: `Предупреждение выдано ${target}. Case сохранён в журнале.`,
      ephemeral: true
    });
  }

  async timeout(
    interaction: ChatInputCommandInteraction,
    member: GuildMember,
    durationMinutes: number,
    reason: string
  ): Promise<void> {
    if (!interaction.guild || !await this.enabled(interaction.guild.id)) {
      await interaction.reply({ content: "Модуль Moderation выключен для этого сервера.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Moderate Members.", ephemeral: true });
      return;
    }
    if (!member.moderatable) {
      await interaction.reply({
        content: "Я не могу применить timeout к этому участнику: проверь role hierarchy и права бота.",
        ephemeral: true
      });
      return;
    }

    const expires = new Date(Date.now() + durationMinutes * 60_000);
    await member.timeout(durationMinutes * 60_000, reason);
    await this.audit("moderation.timeout.applied", interaction.guild.id, interaction.user.id, member.id, { durationMinutes, reason });
    const caseId = await this.recordBestEffort(interaction.guild.id, member.id, interaction.user.id, "timeout", reason, expires);

    await interaction.reply({
      content: `Timeout для ${member} на ${durationMinutes} мин.${caseId ? ` Case #${caseId}.` : " Case не удалось записать."}`,
      ephemeral: true
    });
  }

  async kick(interaction: ChatInputCommandInteraction, member: GuildMember, reason: string): Promise<void> {
    if (!interaction.guild || !await this.enabled(interaction.guild.id)) {
      await interaction.reply({ content: "Модуль Moderation выключен для этого сервера.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Kick Members.", ephemeral: true });
      return;
    }
    if (!member.kickable) {
      await interaction.reply({
        content: "Я не могу исключить этого участника: проверь role hierarchy и права бота.",
        ephemeral: true
      });
      return;
    }

    await member.kick(reason);
    await this.audit("moderation.kick.applied", interaction.guild.id, interaction.user.id, member.id, { reason });
    const caseId = await this.recordBestEffort(interaction.guild.id, member.id, interaction.user.id, "kick", reason);

    await interaction.reply({
      content: `${member.user.tag} исключён.${caseId ? ` Case #${caseId}.` : " Case не удалось записать."}`,
      ephemeral: true
    });
  }

  async unban(interaction: ChatInputCommandInteraction, target: User, reason: string): Promise<void> {
    if (!interaction.guild || !await this.enabled(interaction.guild.id)) {
      await interaction.reply({ content: "Модуль Moderation выключен для этого сервера.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Ban Members.", ephemeral: true });
      return;
    }

    try {
      await interaction.guild.members.unban(target, reason);
    } catch (error) {
      logger.warn("Moderation unban failed", { guildId: interaction.guild.id, moderatorUserId: interaction.user.id, targetUserId: target.id, error: String(error) });
      await interaction.reply({
        content: "Не удалось разблокировать пользователя. Проверь бан и права бота.",
        ephemeral: true
      });
      return;
    }

    await this.audit("moderation.unban.applied", interaction.guild.id, interaction.user.id, target.id, { reason });
    const caseId = await this.recordBestEffort(interaction.guild.id, target.id, interaction.user.id, "unban", reason);

    await interaction.reply({
      content: target.tag + " разблокирован." + (caseId ? ` Case #${caseId}.` : " Case не удалось записать."),
      ephemeral: true
    });
  }

  async ban(
    interaction: ChatInputCommandInteraction,
    member: GuildMember,
    reason: string,
    durationMinutes?: number
  ): Promise<void> {
    if (!interaction.guild || !await this.enabled(interaction.guild.id)) {
      await interaction.reply({ content: "Модуль Moderation выключен для этого сервера.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Ban Members.", ephemeral: true });
      return;
    }
    if (!member.bannable) {
      await interaction.reply({
        content: "Я не могу заблокировать этого участника: проверь role hierarchy и права бота.",
        ephemeral: true
      });
      return;
    }

    await member.ban({ reason });
    const expiresAt = durationMinutes && durationMinutes > 0
      ? new Date(Date.now() + durationMinutes * 60_000)
      : null;

    await this.audit("moderation.ban.applied", interaction.guild.id, interaction.user.id, member.id, {
      reason,
      ...(expiresAt ? { durationMinutes } : {})
    });
    const caseId = await this.recordBestEffort(
      interaction.guild.id,
      member.id,
      interaction.user.id,
      "ban",
      reason,
      expiresAt
    );

    await interaction.reply({
      content: `${member.user.tag} заблокирован.${expiresAt ? ` Срок: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>.` : ""}${caseId ? ` Case #${caseId}.` : " Case не удалось записать."}`,
      ephemeral: true
    });
  }

  async warnFromMessage(message: Message, target: User, reason: string): Promise<void> {
    if (!message.guild || !await this.enabled(message.guild.id)) {
      await message.reply("Модуль Moderation выключен.");
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("Недостаточно прав: Moderate Members.");
      return;
    }
    await this.applyWarn(message.guild.id, message.author.id, target, reason);
    await message.reply(`⚠️ Предупреждение выдано ${target}. Case сохранён.`);
  }

  async timeoutFromMessage(message: Message, member: GuildMember, durationMinutes: number, reason: string): Promise<void> {
    if (!message.guild || !await this.enabled(message.guild.id)) {
      await message.reply("Модуль Moderation выключен.");
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await message.reply("Недостаточно прав: Moderate Members.");
      return;
    }
    if (!member.moderatable) {
      await message.reply("Я не могу применить timeout: проверь role hierarchy и права бота.");
      return;
    }
    const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
    await member.timeout(durationMinutes * 60_000, reason);
    await this.audit("moderation.timeout.applied", message.guild.id, message.author.id, member.id, { durationMinutes, reason });
    const caseId = await this.recordBestEffort(message.guild.id, member.id, message.author.id, "timeout", reason, expiresAt);
    await message.reply(`⏳ Timeout ${member} на ${durationMinutes} мин.${caseId ? ` Case #${caseId}.` : ""}`);
  }

  async kickFromMessage(message: Message, member: GuildMember, reason: string): Promise<void> {
    if (!message.guild || !await this.enabled(message.guild.id)) {
      await message.reply("Модуль Moderation выключен.");
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.KickMembers)) {
      await message.reply("Недостаточно прав: Kick Members.");
      return;
    }
    if (!member.kickable) {
      await message.reply("Я не могу исключить этого участника: проверь role hierarchy.");
      return;
    }
    await member.kick(reason);
    await this.audit("moderation.kick.applied", message.guild.id, message.author.id, member.id, { reason });
    await this.recordBestEffort(message.guild.id, member.id, message.author.id, "kick", reason);
    await message.reply(`👢 ${member.user.tag} исключён.`);
  }

  async banFromMessage(message: Message, member: GuildMember, reason: string, durationMinutes?: number): Promise<void> {
    if (!message.guild || !await this.enabled(message.guild.id)) {
      await message.reply("Модуль Moderation выключен.");
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
      await message.reply("Недостаточно прав: Ban Members.");
      return;
    }
    if (!member.bannable) {
      await message.reply("Я не могу заблокировать этого участника: проверь role hierarchy и права бота.");
      return;
    }
    await member.ban({ reason });
    const expiresAt = durationMinutes && durationMinutes > 0
      ? new Date(Date.now() + durationMinutes * 60_000)
      : null;
    await this.audit("moderation.ban.applied", message.guild.id, message.author.id, member.id, { reason, ...(expiresAt ? { durationMinutes } : {}) });
    await this.recordBestEffort(message.guild.id, member.id, message.author.id, "ban", reason, expiresAt);
    await message.reply(`🔨 ${member.user.tag} заблокирован.${expiresAt ? ` Срок: <t:${Math.floor(expiresAt.getTime()/1000)}:R>.` : ""}`);
  }

  async unbanFromMessage(message: Message, userId: string, reason: string): Promise<void> {
    if (!message.guild || !await this.enabled(message.guild.id)) {
      await message.reply("Модуль Moderation выключен.");
      return;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
      await message.reply("Недостаточно прав: Ban Members.");
      return;
    }
    try {
      await message.guild.members.unban(userId, reason);
    } catch (error) {
      logger.warn("Moderation prefix unban failed", { guildId: message.guild.id, userId, error: String(error) });
      await message.reply("Не удалось разблокировать пользователя.");
      return;
    }
    await this.audit("moderation.unban.applied", message.guild.id, message.author.id, userId, { reason });
    await this.recordBestEffort(message.guild.id, userId, message.author.id, "unban", reason);
    await message.reply(`✅ Пользователь <@${userId}> разблокирован.`);
  }

  async applyAutomodBan(guildId: string, targetUserId: string, reason: string): Promise<boolean> {
    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member?.bannable) return false;

    await member.ban({ reason });
    await this.audit("moderation.ban.applied", guildId, "automod", targetUserId, {
      reason,
      source: "automod"
    });
    await this.recordBestEffort(guildId, targetUserId, "automod", "ban", reason);
    return true;
  }

  async applyAutomodWarn(guildId: string, target: User, reason: string): Promise<void> {
    await this.applyWarn(guildId, "automod", target, reason);
  }

  private async applyWarn(guildId: string, moderatorUserId: string, target: User, reason: string): Promise<void> {
    await this.audit("moderation.warn.attempted", guildId, moderatorUserId, target.id, { reason });
    const caseId = await this.recordBestEffort(guildId, target.id, moderatorUserId, "warn", reason);
    await this.safeDm(target, `На сервере тебе выдано предупреждение. Причина: ${reason}`);
    if (caseId) await this.applyEscalationIfNeeded(guildId, target.id, caseId);
  }

  private async applyEscalationIfNeeded(guildId: string, targetUserId: string, warnCaseId: number): Promise<void> {
    try {
      const countResult = await this.db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM moderation_cases WHERE guild_id=$1 AND target_user_id=$2 AND action='warn'",
        [guildId, targetUserId]
      );
      const warnCount = Number(countResult.rows[0]?.count ?? 0);
      if (!Number.isInteger(warnCount) || warnCount < 1) return;

      const ruleResult = await this.db.query<{
        warn_count: number;
        action: "timeout" | "ban";
        duration_minutes: number;
        reason: string;
      }>(
        "SELECT warn_count,action,duration_minutes,reason FROM moderation_escalations WHERE guild_id=$1 AND warn_count=$2 AND enabled=true",
        [guildId, warnCount]
      );
      const rule = ruleResult.rows[0];
      if (!rule) return;

      const guild = this.client?.guilds.cache.get(guildId);
      if (!guild) return;

      if (rule.action === "timeout") {
        const member = await guild.members.fetch(targetUserId).catch(() => null);
        if (!member?.moderatable || rule.duration_minutes < 1) return;
        const expiresAt = new Date(Date.now() + rule.duration_minutes * 60_000);
        await member.timeout(rule.duration_minutes * 60_000, rule.reason);
        const caseId = await this.recordBestEffort(
          guildId,
          targetUserId,
          "system",
          "timeout",
          rule.reason,
          expiresAt
        );
        await this.audit("moderation.escalation.timeout", guildId, "system", targetUserId, {
          warnCount,
          warnCaseId,
          durationMinutes: rule.duration_minutes,
          escalationCaseId: caseId
        });
        const targetUser = await this.client?.users.fetch(targetUserId).catch(() => null);
        if (targetUser) await this.safeDm(targetUser, `Автоматическая эскалация после ${warnCount} предупреждений: timeout на ${rule.duration_minutes} мин. Причина: ${rule.reason}`);
        return;
      }

      const member = await guild.members.fetch(targetUserId).catch(() => null);
      if (member && !member.bannable) return;
      const durationMinutes = rule.duration_minutes > 0 ? rule.duration_minutes : undefined;
      const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null;
      if (member) {
        await member.ban({ reason: rule.reason });
      } else {
        await guild.members.ban(targetUserId, { reason: rule.reason });
      }
      const caseId = await this.recordBestEffort(
        guildId,
        targetUserId,
        "system",
        "ban",
        rule.reason,
        expiresAt
      );
      await this.audit("moderation.escalation.ban", guildId, "system", targetUserId, {
        warnCount,
        warnCaseId,
        durationMinutes: durationMinutes ?? null,
        escalationCaseId: caseId
      });
      const targetUser = await this.client?.users.fetch(targetUserId).catch(() => null);
      if (targetUser) await this.safeDm(targetUser, `Автоматическая эскалация после ${warnCount} предупреждений: бан. Причина: ${rule.reason}`);
    } catch (error) {
      logger.warn("Moderation escalation failed", { guildId, targetUserId, warnCaseId, error: String(error) });
    }
  }

  async setEscalation(
    guildId: string,
    warnCount: number,
    action: "timeout" | "ban",
    durationMinutes: number,
    reason: string
  ): Promise<void> {
    if (!Number.isInteger(warnCount) || warnCount < 1 || warnCount > 100) throw new Error("invalid_escalation_warn_count");
    if (action === "timeout" && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 40320)) {
      throw new Error("invalid_escalation_duration");
    }
    if (action === "ban" && (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 40320)) {
      throw new Error("invalid_escalation_duration");
    }
    const cleanReason = reason.trim().slice(0, 500);
    if (!cleanReason) throw new Error("invalid_escalation_reason");

    await this.db.query(
      `INSERT INTO moderation_escalations(guild_id,warn_count,action,duration_minutes,reason,enabled)
       VALUES($1,$2,$3,$4,$5,true)
       ON CONFLICT(guild_id,warn_count)
       DO UPDATE SET action=EXCLUDED.action,duration_minutes=EXCLUDED.duration_minutes,reason=EXCLUDED.reason,enabled=true,updated_at=now()`,
      [guildId,warnCount,action,durationMinutes,cleanReason]
    );
  }

  async listEscalations(guildId: string): Promise<Array<{
    warnCount: number;
    action: "timeout" | "ban";
    durationMinutes: number;
    reason: string;
    enabled: boolean;
  }>> {
    const result = await this.db.query<{
      warn_count: number;
      action: "timeout" | "ban";
      duration_minutes: number;
      reason: string;
      enabled: boolean;
    }>(
      "SELECT warn_count,action,duration_minutes,reason,enabled FROM moderation_escalations WHERE guild_id=$1 ORDER BY warn_count",
      [guildId]
    );
    return result.rows.map((row) => ({
      warnCount: row.warn_count,
      action: row.action,
      durationMinutes: row.duration_minutes,
      reason: row.reason,
      enabled: row.enabled
    }));
  }

  async removeEscalation(guildId: string, warnCount: number): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM moderation_escalations WHERE guild_id=$1 AND warn_count=$2",
      [guildId,warnCount]
    );
    return result.rowCount === 1;
  }

  private async recordBestEffort(
    guildId: string,
    targetUserId: string,
    moderatorUserId: string,
    action: ModerationAction,
    reason: string | null,
    expiresAt: Date | null = null
  ): Promise<number | null> {
    try {
      return await this.record(guildId, targetUserId, moderatorUserId, action, reason, expiresAt);
    } catch (error) {
      logger.error("Moderation case persistence failed after action was applied", { guildId, targetUserId, moderatorUserId, action, error: String(error) });
      return null;
    }
  }

  private async safeDm(user: User, message: string): Promise<void> {
    await user.send(message).catch((error) => {
      logger.info("Moderation user DM could not be delivered", { userId: user.id, error: String(error) });
    });
  }

  private async processScheduledCleanup(): Promise<void> {
    if (!this.client || this.client.readyAt === null) return;
    try {
      const claimed = await this.db.query<{ id: string; guild_id: string; channel_id: string; max_messages: number }>(
        "UPDATE moderation_cleanup_rules mcr SET processing_until=now()+interval '2 minutes',last_run_at=now() FROM (SELECT m.id FROM moderation_cleanup_rules m INNER JOIN guild_bot_assignments ga ON ga.guild_id=m.guild_id LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id WHERE m.enabled=true AND (m.last_run_at IS NULL OR m.last_run_at <= now()-make_interval(secs => m.interval_seconds)) AND (m.processing_until IS NULL OR m.processing_until < now()) AND (ga.bot_identity_id=$1 OR ($1='primary' AND ga.bot_identity_id <> 'primary' AND (bh.last_seen_at IS NULL OR bh.last_seen_at < now()-interval '90 seconds'))) ORDER BY m.last_run_at NULLS FIRST LIMIT 20 FOR UPDATE SKIP LOCKED) claim WHERE mcr.id=claim.id RETURNING mcr.id,mcr.guild_id,mcr.channel_id,mcr.max_messages",
        [this.identityId]
      );

      for (const rule of claimed.rows) {
        try {
          if (!await this.enabled(rule.guild_id)) {
            await this.db.query("UPDATE moderation_cleanup_rules SET processing_until=NULL WHERE id=$1",[rule.id]);
            continue;
          }
          const guild = this.client.guilds.cache.get(rule.guild_id);
          const channel = guild?.channels.cache.get(rule.channel_id);
          if (!channel || !channel.isTextBased() || !("bulkDelete" in channel)) throw new Error("cleanup_channel_unavailable");
          const deleted = await channel.bulkDelete(rule.max_messages, true);
          await this.audit("moderation.autopurge",rule.guild_id,"system",rule.channel_id,{cleanupRuleId:Number(rule.id),requested:rule.max_messages,deleted:deleted.size});
          await this.db.query("UPDATE moderation_cleanup_rules SET processing_until=NULL WHERE id=$1",[rule.id]);
        } catch (error) {
          await this.db.query("UPDATE moderation_cleanup_rules SET processing_until=NULL WHERE id=$1",[rule.id]).catch(() => undefined);
          logger.warn("Scheduled moderation cleanup failed",{cleanupRuleId:rule.id,guildId:rule.guild_id,channelId:rule.channel_id,error:String(error)});
        }
      }
    } catch (error) {
      logger.warn("Scheduled moderation cleanup worker failed",{identityId:this.identityId,error:String(error)});
    }
  }
  private async processExpiredTimedPunishments(): Promise<void> {
    if (!this.client) return;

    try {
      const expired = await this.db.query<{
        id: string;
        guild_id: string;
        target_user_id: string;
        action: "ban" | "timeout";
      }>(
        `SELECT mc.id,mc.guild_id,mc.target_user_id,mc.action
         FROM moderation_cases mc
         INNER JOIN guild_bot_assignments ga ON ga.guild_id=mc.guild_id
         LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id
         WHERE mc.action IN ('ban','timeout')
           AND mc.expires_at IS NOT NULL
           AND mc.expires_at <= now()
           AND mc.resolved_at IS NULL
           AND (
             ga.bot_identity_id=$1
             OR (
               $1='primary'
               AND ga.bot_identity_id <> 'primary'
               AND (bh.last_seen_at IS NULL OR bh.last_seen_at < now()-interval '90 seconds')
             )
           )
         ORDER BY mc.expires_at ASC
         LIMIT 50`,
        [this.identityId]
      );

      for (const row of expired.rows) {
        const claimed = await this.db.query<{ id: string }>(
          "UPDATE moderation_cases SET resolved_at=now() WHERE id=$1 AND resolved_at IS NULL RETURNING id",
          [row.id]
        );
        if (!claimed.rows[0]) continue;

        try {
          const guild = this.client.guilds.cache.get(row.guild_id);
          if (!guild) throw new Error("guild_not_cached");

          if (row.action === "ban") {
            await guild.members.unban(row.target_user_id, "Timed ban expired");
          } else {
            const member = await guild.members.fetch(row.target_user_id).catch(() => null);
            if (member) await member.timeout(null, "Timed timeout expired");
          }

          await this.audit(
            row.action === "ban" ? "moderation.ban.expired" : "moderation.timeout.expired",
            row.guild_id,
            "system",
            row.target_user_id,
            { caseId: Number(row.id) }
          );
        } catch (error) {
          await this.db.query("UPDATE moderation_cases SET resolved_at=NULL WHERE id=$1", [row.id]);
          logger.warn("Timed punishment expiry failed", {
            guildId: row.guild_id,
            userId: row.target_user_id,
            action: row.action,
            caseId: row.id,
            error: String(error)
          });
        }
      }
    } catch (error) {
      logger.warn("Timed punishment worker cycle failed", { identityId: this.identityId, error: String(error) });
    }
  }

  async audit(
    action: string,
    guildId: string,
    actorUserId: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.auditLog?.record({
        guildId,
        actorUserId,
        source: actorUserId === "system" ? "system" : "discord",
        action,
        targetType: "user",
        targetId,
        metadata
      });
    } catch (error) {
      logger.error("Moderation audit write failed", { guildId, actorUserId, targetId, action, error: String(error) });
    }
  }
}
