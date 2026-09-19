import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
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

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.events = context.events;
    this.auditLog = context.auditLog;
  }

  async shutdown(): Promise<void> {}

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
        caseId
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

  private async enabled(guildId: string): Promise<boolean> {
    const result = await this.db.query<{ enabled: boolean }>(
      "SELECT enabled FROM guild_modules WHERE guild_id=$1 AND module_key='moderation'",
      [guildId]
    );
    return result.rows[0]?.enabled ?? true;
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

    await this.audit("moderation.warn.attempted", interaction.guild.id, interaction.user.id, target.id, { reason });
    const caseId = await this.recordBestEffort(
      interaction.guild.id,
      target.id,
      interaction.user.id,
      "warn",
      reason
    );
    await interaction.reply({
      content: `Предупреждение выдано ${target}.${caseId ? ` Case #${caseId}.` : " Case не удалось записать в БД — действие применено."}`,
      ephemeral: true
    });

    await this.safeDm(
      target,
      `На сервере ${interaction.guild.name} тебе выдано предупреждение. Причина: ${reason}`
    );
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
    await this.audit("moderation.timeout.applied", interaction.guild.id, interaction.user.id, member.id, {
      durationMinutes,
      reason
    });
    const caseId = await this.recordBestEffort(
      interaction.guild.id,
      member.id,
      interaction.user.id,
      "timeout",
      reason,
      expires
    );

    await interaction.reply({
      content: `Timeout для ${member} на ${durationMinutes} мин.${caseId ? ` Case #${caseId}.` : " Case не удалось записать в БД — действие применено."}`,
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
      content: `${member.user.tag} исключён.${caseId ? ` Case #${caseId}.` : " Case не удалось записать в БД — действие применено."}`,
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
      logger.warn("Moderation unban failed", {
        guildId: interaction.guild.id,
        moderatorUserId: interaction.user.id,
        targetUserId: target.id,
        error: String(error)
      });
      await interaction.reply({
        content: "Не удалось разблокировать пользователя. Проверь, что он действительно находится в бане и что у бота есть Ban Members.",
        ephemeral: true
      });
      return;
    }

    await this.audit("moderation.unban.applied", interaction.guild.id, interaction.user.id, target.id, { reason });
    const caseId = await this.recordBestEffort(
      interaction.guild.id,
      target.id,
      interaction.user.id,
      "unban",
      reason
    );

    await interaction.reply({
      content: target.tag + " разблокирован." + (caseId ? " Case #" + caseId + "." : " Case не удалось записать в БД — действие применено."),
      ephemeral: true
    });
  }

  async ban(interaction: ChatInputCommandInteraction, member: GuildMember, reason: string): Promise<void> {
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
    await this.audit("moderation.ban.applied", interaction.guild.id, interaction.user.id, member.id, { reason });
    const caseId = await this.recordBestEffort(interaction.guild.id, member.id, interaction.user.id, "ban", reason);

    await interaction.reply({
      content: `${member.user.tag} заблокирован.${caseId ? ` Case #${caseId}.` : " Case не удалось записать в БД — действие применено."}`,
      ephemeral: true
    });
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
      logger.error("Moderation case persistence failed after action was applied", {
        guildId,
        targetUserId,
        moderatorUserId,
        action,
        error: String(error)
      });
      return null;
    }
  }

  private async safeDm(user: User, message: string): Promise<void> {
    await user.send(message).catch((error) => {
      logger.info("Moderation user DM could not be delivered", {
        userId: user.id,
        error: String(error)
      });
    });
  }

  private async audit(
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
        source: "discord",
        action,
        targetType: "user",
        targetId,
        metadata
      });
    } catch (error) {
      logger.error("Moderation audit write failed", {
        guildId,
        actorUserId,
        targetId,
        action,
        error: String(error)
      });
    }
  }
}
