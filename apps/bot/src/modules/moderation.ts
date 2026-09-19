import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type User
} from "discord.js";
import type { Database } from "../database.js";
import type { PlatformModule, ModuleContext } from "../module.js";

type ModerationAction = "warn" | "timeout" | "kick" | "ban" | "unban";

export class Moderation implements PlatformModule {
  readonly name = "moderation";

  constructor(private readonly db: Database) {}

  async init(_context: ModuleContext): Promise<void> {}

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
    return Number(result.rows[0]?.id);
  }

  async warn(interaction: ChatInputCommandInteraction, target: User, reason: string): Promise<void> {
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Moderate Members.", ephemeral: true });
      return;
    }

    const caseId = await this.record(
      interaction.guild.id,
      target.id,
      interaction.user.id,
      "warn",
      reason
    );

    await interaction.reply({
      content: `Предупреждение выдано ${target}. Case #${caseId}.`,
      ephemeral: true
    });

    await this.safeDm(target, `На сервере ${interaction.guild.name} тебе выдано предупреждение. Причина: ${reason}`);
  }

  async timeout(
    interaction: ChatInputCommandInteraction,
    member: GuildMember,
    durationMinutes: number,
    reason: string
  ): Promise<void> {
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Moderate Members.", ephemeral: true });
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
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Kick Members.", ephemeral: true });
      return;
    }

    const caseId = await this.record(interaction.guild.id, member.id, interaction.user.id, "kick", reason);
    await member.kick(reason);

    await interaction.reply({
      content: `${member.user.tag} исключён. Case #${caseId}.`,
      ephemeral: true
    });
  }

  async ban(interaction: ChatInputCommandInteraction, member: GuildMember, reason: string): Promise<void> {
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({ content: "Недостаточно прав: Ban Members.", ephemeral: true });
      return;
    }

    const caseId = await this.record(interaction.guild.id, member.id, interaction.user.id, "ban", reason);
    await member.ban({ reason });

    await interaction.reply({
      content: `${member.user.tag} заблокирован. Case #${caseId}.`,
      ephemeral: true
    });
  }

  private async safeDm(user: User, message: string): Promise<void> {
    await user.send(message).catch(() => undefined);
  }
}
