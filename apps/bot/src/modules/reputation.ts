import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Reputation implements PlatformModule {
  readonly name = "reputation";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => a();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return;
    if (interaction.commandName === "rep") {
      await this.handleRep(interaction);
      return;
    }
    if (interaction.commandName === "profile") {
      await this.handleProfile(interaction);
      return;
    }
    if (interaction.commandName === "achievements") {
      await this.handleAchievements(interaction);
    }
  }

  private async handleRep(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!await moduleEnabled(this.db, interaction.guild!.id, "reputation", false)) {
      await interaction.reply({ content: "Модуль Reputation выключен.", ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild!.id;

    if (sub === "give") {
      const target = interaction.options.getUser("user", true);
      if (target.bot || target.id === interaction.user.id) {
        await interaction.reply({ content: "Нельзя выдать rep самому себе или боту.", ephemeral: true });
        return;
      }
      const claimed = await this.db.query<{ from_user_id: string }>(
        "INSERT INTO reputation_gifts(guild_id,from_user_id,to_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING from_user_id",
        [guildId,interaction.user.id,target.id]
      );
      if (!claimed.rows[0]) {
        await interaction.reply({ content: "Ты уже выдавал этому пользователю rep сегодня.", ephemeral: true });
        return;
      }
      await this.db.query(
        "INSERT INTO reputation_points(guild_id,user_id,points) VALUES($1,$2,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET points=reputation_points.points+1,updated_at=now()",
        [guildId,target.id]
      );
      const score = await this.getPoints(guildId,target.id);
      await interaction.reply({ content: "👍 " + target.toString() + " получает +1 rep. Всего: **" + score + "**.", ephemeral: false });
      return;
    }

    if (sub === "leaderboard") {
      const result = await this.db.query<{ user_id:string; points:number }>(
        "SELECT user_id,points FROM reputation_points WHERE guild_id=$1 ORDER BY points DESC,user_id LIMIT 10",
        [guildId]
      );
      const lines = result.rows.map((row,index) => (index+1) + ". <@" + row.user_id + "> — **" + row.points + "** rep");
      await interaction.reply({ content: lines.length ? "🏆 **Reputation leaderboard**\n" + lines.join("\n") : "Репутация пока не выдавалась." });
      return;
    }

    const user = interaction.options.getUser("user") ?? interaction.user;
    const points = await this.getPoints(guildId,user.id);
    await interaction.reply({ content: "⭐ " + user.toString() + " — **" + points + "** rep.", ephemeral: false });
  }

  private async handleProfile(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!await moduleEnabled(this.db, interaction.guild!.id, "reputation", false)) {
      await interaction.reply({ content: "Модуль Reputation выключен.", ephemeral: true });
      return;
    }
    const guildId = interaction.guild!.id;
    const target = interaction.options.getUser("user") ?? interaction.user;
    const bioInput = interaction.options.getString("bio");
    if (bioInput !== null) {
      if (target.id !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Изменять bio может только сам пользователь или Manage Server.", ephemeral: true });
        return;
      }
      const bio = bioInput.trim().slice(0,500);
      await this.db.query(
        "INSERT INTO social_profiles(guild_id,user_id,bio) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET bio=EXCLUDED.bio,updated_at=now()",
        [guildId,target.id,bio]
      );
    }
    const profile = await this.db.query<{ bio:string }>(
      "SELECT bio FROM social_profiles WHERE guild_id=$1 AND user_id=$2",[guildId,target.id]
    );
    const points = await this.getPoints(guildId,target.id);
    const bio = profile.rows[0]?.bio ?? "Био пока не заполнено.";
    await interaction.reply({
      content: "👤 **Профиль " + target.username + "**\n⭐ Rep: **" + points + "**\n📝 " + bio,
      ephemeral: false
    });
  }

  private async handleAchievements(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    if (!await moduleEnabled(this.db, guildId, "reputation", false)) {
      await interaction.reply({ content: "Модуль Reputation выключен.", ephemeral: true });
      return;
    }

    const user = interaction.options.getUser("user") ?? interaction.user;
    const points = await this.getPoints(guildId, user.id);
    const levelResult = await this.db.query<{ level:number }>(
      "SELECT level FROM leveling_users WHERE guild_id=$1 AND user_id=$2",
      [guildId,user.id]
    );
    const inviteResult = await this.db.query<{ joins:number }>(
      "SELECT joins FROM invite_stats WHERE guild_id=$1 AND user_id=$2",
      [guildId,user.id]
    );
    const birthdayResult = await this.db.query<{ user_id:string }>(
      "SELECT user_id FROM birthdays WHERE guild_id=$1 AND user_id=$2",
      [guildId,user.id]
    );

    const level = Number(levelResult.rows[0]?.level ?? 0);
    const invites = Number(inviteResult.rows[0]?.joins ?? 0);
    const achievements = [
      [points >= 1, "⭐ Первый rep"],
      [points >= 10, "🏆 10 rep"],
      [level >= 5, "📈 Level 5"],
      [invites >= 5, "📨 Пригласил 5 участников"],
      [birthdayResult.rows.length > 0, "🎂 День рождения заполнен"]
    ];

    const unlocked = achievements.filter(([ok]) => ok).map(([, name]) => String(name));
    const locked = achievements.filter(([ok]) => !ok).map(([, name]) => "🔒 " + String(name));
    await interaction.reply({
      content: "🏅 **Achievements " + user.username + "**\n\n" + [...unlocked, ...locked].join("\n"),
      ephemeral: false
    });
  }

  async dashboardLeaderboard(guildId: string, limit = 8): Promise<Array<{ userId: string; points: number }>> {
    const safe = Math.min(Math.max(Math.floor(limit), 1), 25);
    const result = await this.db.query<{ user_id: string; points: number }>(
      "SELECT user_id,points FROM reputation_points WHERE guild_id=$1 ORDER BY points DESC,user_id LIMIT $2",
      [guildId, safe]
    );
    return result.rows.map((row) => ({ userId: row.user_id, points: Number(row.points) }));
  }

  private async getPoints(guildId: string,userId: string): Promise<number> {
    const result = await this.db.query<{ points:number }>(
      "SELECT points FROM reputation_points WHERE guild_id=$1 AND user_id=$2",[guildId,userId]
    );
    return Number(result.rows[0]?.points ?? 0);
  }
}
