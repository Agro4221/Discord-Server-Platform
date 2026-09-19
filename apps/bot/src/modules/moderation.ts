import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type User
} from "discord.js";
import type { Database } from "../database.js";
import type { PlatformModule, ModuleContext } from "../module.js";
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

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.events = context.events;
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

    const caseId = await this.record(interaction.guild.id, target.id, interaction.user.id, "warn", reason);
    await interaction.reply({
      content: `Предупреждение выдано ${target}. Case #${caseId}.`,
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
    const caseId = await this.record(
      interaction.guild.id,
      member.id,
      interaction.user.id,
      "timeout",
      reason,
      expires
    );

    await interaction.reply({
      content: `Timeout для ${member} на ${durationMinutes} мин. Case #${caseId}.`,
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
    const caseId = await this.record(interaction.guild.id, member.id, interaction.user.id, "kick", reason);

    await interaction.reply({
      content: `${member.user.tag} исключён. Case #${caseId}.`,
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
    const caseId = await this.record(interaction.guild.id, member.id, interaction.user.id, "ban", reason);

    await interaction.reply({
      content: `${member.user.tag} заблокирован. Case #${caseId}.`,
      ephemeral: true
    });
  }

  private async safeDm(user: User, message: string): Promise<void> {
    await user.send(message).catch(() => undefined);
  }
}
