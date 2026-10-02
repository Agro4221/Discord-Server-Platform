import { EmbedBuilder, type ChatInputCommandInteraction, PermissionFlagsBits, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type LevelRow = {
  xp: string | number;
  level: number;
  text_xp?: string | number;
  voice_xp?: string | number;
};

type LevelSettings = {
  enabled: boolean;
  xpPerMessage: number;
  cooldownSeconds: number;
  announceLevelUp: boolean;
  voiceEnabled: boolean;
  voiceXpPerMinute: number;
  voiceIgnoreAfk: boolean;
  voiceMinMembers: number;
  dailyXpCap: number;
};

export class Leveling implements PlatformModule {
  readonly name = "leveling";
  private unsubscribe?: () => void;
  private voiceTimer?: NodeJS.Timeout;
  private readonly cooldowns = new Map<string, number>();
  private messageCounter = 0;
  private client?: ModuleContext["client"];

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const a = context.events.on("message.create", (message) => this.onMessage(message));
    const b = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => { a(); b(); };

    this.voiceTimer = setInterval(() => {
      void this.awardVoiceXp();
    }, 60_000);
    this.voiceTimer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.voiceTimer) clearInterval(this.voiceTimer);
    this.voiceTimer = undefined;
    this.cooldowns.clear();
    this.messageCounter = 0;
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return;

    if (interaction.commandName === "leveling") {
      const sub = interaction.options.getSubcommand();
      if (sub === "setup") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
          return;
        }

        await this.configure(interaction.guild!.id, {
          xpPerMessage: interaction.options.getInteger("xp") ?? 10,
          cooldownSeconds: interaction.options.getInteger("cooldown") ?? 30,
          announceLevelUp: interaction.options.getBoolean("announce") ?? true,
          dailyXpCap: interaction.options.getInteger("daily-cap") ?? 0
        });

        await interaction.reply({ content: "Leveling настроен и включён.", ephemeral: true });
        return;
      }

      if (sub === "rank") {
        await this.replyRank(interaction, interaction.options.getUser("user") ?? interaction.user);
        return;
      }

      if (sub === "top") {
        await this.replyTop(interaction);
        return;
      }
      return;
    }

    if (interaction.commandName === "level") {
      await this.replyRank(interaction, interaction.options.getUser("user") ?? interaction.user);
    } else if (interaction.commandName === "rank") {
      await this.replyRank(interaction, interaction.options.getUser("user") ?? interaction.user);
    } else if (interaction.commandName === "top") {
      await this.replyTop(interaction);
    }
  }

  private async configure(guildId: string, patch: Partial<Omit<LevelSettings, "enabled">>): Promise<void> {
    const current = await this.settings(guildId);
    const next = {
      xpPerMessage: patch.xpPerMessage ?? current.xpPerMessage,
      cooldownSeconds: patch.cooldownSeconds ?? current.cooldownSeconds,
      announceLevelUp: patch.announceLevelUp ?? current.announceLevelUp,
      voiceEnabled: patch.voiceEnabled ?? current.voiceEnabled,
      voiceXpPerMinute: patch.voiceXpPerMinute ?? current.voiceXpPerMinute,
      voiceIgnoreAfk: patch.voiceIgnoreAfk ?? current.voiceIgnoreAfk,
      voiceMinMembers: patch.voiceMinMembers ?? current.voiceMinMembers,
      dailyXpCap: patch.dailyXpCap ?? current.dailyXpCap
    };

    await this.db.query(
      `INSERT INTO leveling_settings(
        guild_id,enabled,xp_per_message,cooldown_seconds,announce_level_up,
        voice_enabled,voice_xp_per_minute,voice_ignore_afk,voice_min_members,daily_xp_cap
      )
      VALUES($1,true,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(guild_id) DO UPDATE SET
        enabled=true,
        xp_per_message=EXCLUDED.xp_per_message,
        cooldown_seconds=EXCLUDED.cooldown_seconds,
        announce_level_up=EXCLUDED.announce_level_up,
        voice_enabled=EXCLUDED.voice_enabled,
        voice_xp_per_minute=EXCLUDED.voice_xp_per_minute,
        voice_ignore_afk=EXCLUDED.voice_ignore_afk,
        voice_min_members=EXCLUDED.voice_min_members,
        daily_xp_cap=EXCLUDED.daily_xp_cap,
        updated_at=now()`,
      [
        guildId,
        next.xpPerMessage,
        next.cooldownSeconds,
        next.announceLevelUp,
        next.voiceEnabled,
        next.voiceXpPerMinute,
        next.voiceIgnoreAfk,
        next.voiceMinMembers,
        next.dailyXpCap
      ]
    );

    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'leveling',true)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=true,updated_at=now()`,
      [guildId]
    );
  }

  private async settings(guildId: string): Promise<LevelSettings> {
    const result = await this.db.query<{
      enabled: boolean;
      xp_per_message: number;
      cooldown_seconds: number;
      announce_level_up: boolean;
      voice_enabled: boolean;
      voice_xp_per_minute: number;
      voice_ignore_afk: boolean;
      voice_min_members: number;
      daily_xp_cap: string | number;
    }>(
      `SELECT enabled,xp_per_message,cooldown_seconds,announce_level_up,
              voice_enabled,voice_xp_per_minute,voice_ignore_afk,voice_min_members,daily_xp_cap
       FROM leveling_settings WHERE guild_id=$1`,
      [guildId]
    );

    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      xpPerMessage: row?.xp_per_message ?? 10,
      cooldownSeconds: row?.cooldown_seconds ?? 30,
      announceLevelUp: row?.announce_level_up ?? true,
      voiceEnabled: row?.voice_enabled ?? true,
      voiceXpPerMinute: row?.voice_xp_per_minute ?? 5,
      voiceIgnoreAfk: row?.voice_ignore_afk ?? true,
      voiceMinMembers: row?.voice_min_members ?? 1,
      dailyXpCap: Number(row?.daily_xp_cap ?? 0)
    };
  }

  private async replyRank(
    interaction: ChatInputCommandInteraction,
    target: import("discord.js").User
  ): Promise<void> {
    const guildId = interaction.guild!.id;
    if (!await moduleEnabled(this.db, guildId, "leveling", false)) {
      await interaction.reply({ content: "Модуль Leveling выключен.", ephemeral: true });
      return;
    }

    const row = await this.getLevelRow(guildId, target.id);
    const rank = await this.getRank(guildId, target.id, Number(row?.xp ?? 0));
    const settings = await this.settings(guildId);
    const embed = this.rankEmbed(target, row, rank, settings);
    await interaction.reply({ embeds: [embed] });
  }

  private async replyTop(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    if (!await moduleEnabled(this.db, guildId, "leveling", false)) {
      await interaction.reply({ content: "Модуль Leveling выключен.", ephemeral: true });
      return;
    }

    const top = await this.db.query<{ user_id: string; xp: string | number; level: number }>(
      "SELECT user_id,xp,level FROM leveling_users WHERE guild_id=$1 ORDER BY xp DESC,updated_at ASC LIMIT 10",
      [guildId]
    );
    const lines = top.rows.map((item, index) =>
      `**#${index + 1}** <@${item.user_id}> · lvl ${item.level} · ${Number(item.xp).toLocaleString("ru-RU")} XP`
    );
    const embed = new EmbedBuilder()
      .setTitle("🏆 Leveling — таблица лидеров")
      .setDescription(lines.length ? lines.join("\n") : "Пока никто не набрал XP.")
      .setFooter({ text: interaction.guild!.name })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async handlePrefixCommand(
    message: Message,
    commandName: string,
    args: string[]
  ): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;
    if (!["level", "rank", "top"].includes(commandName)) return false;
    if (!await moduleEnabled(this.db, message.guild.id, "leveling", false)) {
      await message.reply("Модуль Leveling выключен.");
      return true;
    }

    const mentioned = message.mentions.users.first();
    const target = mentioned ?? message.author;

    if (commandName === "top") {
      const top = await this.db.query<{ user_id: string; xp: string | number; level: number }>(
        "SELECT user_id,xp,level FROM leveling_users WHERE guild_id=$1 ORDER BY xp DESC,updated_at ASC LIMIT 10",
        [message.guild.id]
      );
      const lines = top.rows.map((item, index) =>
        `**#${index + 1}** <@${item.user_id}> · lvl ${item.level} · ${Number(item.xp).toLocaleString("ru-RU")} XP`
      );
      const embed = new EmbedBuilder()
        .setTitle("🏆 Leveling — таблица лидеров")
        .setDescription(lines.length ? lines.join("\n") : "Пока никто не набрал XP.")
        .setFooter({ text: message.guild.name })
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      return true;
    }

    const row = await this.getLevelRow(message.guild.id, target.id);
    const rank = await this.getRank(message.guild.id, target.id, Number(row?.xp ?? 0));
    const settings = await this.settings(message.guild.id);
    await message.reply({ embeds: [this.rankEmbed(target, row, rank, settings)] });
    return true;
  }

  private rankEmbed(
    target: import("discord.js").User,
    row: LevelRow | null,
    rank: number,
    _settings: LevelSettings
  ): EmbedBuilder {
    const xp = Number(row?.xp ?? 0);
    const level = Number(row?.level ?? 0);
    const textXp = Number(row?.text_xp ?? 0);
    const voiceXp = Number(row?.voice_xp ?? 0);
    const currentFloor = level * level * 100;
    const nextFloor = (level + 1) * (level + 1) * 100;
    const progress = Math.max(0, Math.min(1, (xp - currentFloor) / Math.max(1, nextFloor - currentFloor)));
    const filled = Math.round(progress * 20);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);

    return new EmbedBuilder()
      .setAuthor({ name: target.globalName ?? target.username, iconURL: target.displayAvatarURL({ size: 128 }) })
      .setTitle(`Level ${level}`)
      .setDescription(`**${Number.isFinite(xp) ? xp.toLocaleString("ru-RU") : "0"} XP**\n${bar} ${Math.round(progress * 100)}%`)
      .addFields(
        { name: "🏅 Место", value: `#${rank}`, inline: true },
        { name: "💬 Сообщения", value: `${textXp.toLocaleString("ru-RU")} XP`, inline: true },
        { name: "🎙️ Voice", value: `${voiceXp.toLocaleString("ru-RU")} XP`, inline: true },
        { name: "Следующий уровень", value: `${nextFloor.toLocaleString("ru-RU")} XP`, inline: true }
      )
      .setFooter({ text: "Vexa Leveling" })
      .setTimestamp();
  }

  private async getLevelRow(guildId: string, userId: string): Promise<LevelRow | null> {
    const result = await this.db.query<LevelRow>(
      "SELECT xp,level,text_xp,voice_xp FROM leveling_users WHERE guild_id=$1 AND user_id=$2",
      [guildId, userId]
    );
    return result.rows[0] ?? null;
  }

  private async getRank(guildId: string, userId: string, fallbackXp: number): Promise<number> {
    const result = await this.db.query<{ rank: number }>(
      `SELECT COUNT(*)::int + 1 AS rank
       FROM leveling_users
       WHERE guild_id=$1
         AND xp > COALESCE((SELECT xp FROM leveling_users WHERE guild_id=$1 AND user_id=$2), $3)`,
      [guildId, userId, fallbackXp]
    );
    return result.rows[0]?.rank ?? 1;
  }

  private async onMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "leveling", false)) return;

    const setting = await this.settings(message.guild.id);
    if (await this.isExcluded(message.guild.id, message.channelId, message.author.id)) return;
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const previous = this.cooldowns.get(key) ?? 0;
    if (now - previous < setting.cooldownSeconds * 1000) return;
    this.cooldowns.set(key, now);
    this.messageCounter += 1;
    if (this.messageCounter % 100 === 0) this.pruneCooldowns(now);

    await this.addXp(message.guild.id, message.author.id, setting.xpPerMessage, setting.announceLevelUp, message);
  }

  private async awardVoiceXp(): Promise<void> {
    if (!this.client) return;

    for (const guild of this.client.guilds.cache.values()) {
      const setting = await this.settings(guild.id);
      if (!setting.enabled || !setting.voiceEnabled || setting.voiceXpPerMinute <= 0) continue;

      const eligible = [...guild.voiceStates.cache.values()]
        .filter((state) => state.channelId && state.member && !state.member.user.bot)
        .filter((state) => !setting.voiceIgnoreAfk || state.channelId !== guild.afkChannelId)
        .filter((state) => {
          if (setting.voiceMinMembers <= 1) return true;
          const channel = state.channel;
          return Boolean(channel && channel.members.filter((member) => !member.user.bot).size >= setting.voiceMinMembers);
        });

      for (const state of eligible) {
        if (await this.isExcluded(guild.id, state.channelId ?? "", state.id)) continue;
        await this.addXp(
          guild.id,
          state.id,
          setting.voiceXpPerMinute,
          setting.announceLevelUp,
          undefined,
          true
        );
      }
    }
  }

  private async isExcluded(guildId: string, channelId: string, userId: string): Promise<boolean> {
    if (channelId) {
      const channelExcluded = await this.db.query(
        "SELECT 1 FROM leveling_exclusions WHERE guild_id=$1 AND kind='channel' AND ref_id=$2 LIMIT 1",
        [guildId, channelId]
      );
      if (channelExcluded.rows[0]) return true;
    }

    const guild = this.client?.guilds.cache.get(guildId);
    const member = guild?.members.cache.get(userId) ?? await guild?.members.fetch(userId).catch(() => null);
    if (!member) return false;

    const roleIds = member.roles.cache.map((role) => role.id);
    if (!roleIds.length) return false;

    const roleExcluded = await this.db.query(
      "SELECT 1 FROM leveling_exclusions WHERE guild_id=$1 AND kind='role' AND ref_id=ANY($2::text[]) LIMIT 1",
      [guildId, roleIds]
    );
    return Boolean(roleExcluded.rows[0]);
  }

  async listRewards(guildId: string): Promise<Array<{
    level: number;
    roleId: string;
    removePrevious: boolean;
    dmUser: boolean;
    message: string;
  }>> {
    const result = await this.db.query<{
      level: number;
      role_id: string;
      remove_previous: boolean;
      dm_user: boolean;
      message: string;
    }>(
      "SELECT level,role_id,remove_previous,dm_user,message FROM leveling_rewards WHERE guild_id=$1 ORDER BY level ASC",
      [guildId]
    );
    return result.rows.map((row) => ({
      level: row.level,
      roleId: row.role_id,
      removePrevious: row.remove_previous,
      dmUser: row.dm_user,
      message: row.message
    }));
  }

  async upsertReward(guildId: string, input: { level: number; roleId: string; removePrevious?: boolean; dmUser?: boolean; message?: string }): Promise<void> {
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 10000) throw new Error("invalid_reward_level");
    if (!/^\d{15,25}$/.test(input.roleId)) throw new Error("invalid_reward_role");

    const guild = this.client?.guilds.cache.get(guildId);
    const role = guild?.roles.cache.get(input.roleId);
    if (!role || role.managed || role.position >= (guild?.members.me?.roles.highest.position ?? -1)) {
      throw new Error("reward_role_not_manageable");
    }

    await this.db.query(
      "INSERT INTO leveling_rewards(guild_id,level,role_id,remove_previous,dm_user,message) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(guild_id,level) DO UPDATE SET role_id=EXCLUDED.role_id,remove_previous=EXCLUDED.remove_previous,dm_user=EXCLUDED.dm_user,message=EXCLUDED.message,updated_at=now()",
      [guildId,input.level,input.roleId,input.removePrevious ?? true,input.dmUser ?? false,(input.message ?? "").slice(0,1000)]
    );
  }

  async deleteReward(guildId: string, level: number): Promise<boolean> {
    const result = await this.db.query("DELETE FROM leveling_rewards WHERE guild_id=$1 AND level=$2", [guildId,level]);
    return result.rowCount === 1;
  }

  async listExclusions(guildId: string): Promise<Array<{ kind: "role" | "channel"; refId: string }>> {
    const result = await this.db.query<{ kind: "role" | "channel"; ref_id: string }>(
      "SELECT kind,ref_id FROM leveling_exclusions WHERE guild_id=$1 ORDER BY kind,ref_id",
      [guildId]
    );
    return result.rows.map((row) => ({ kind: row.kind, refId: row.ref_id }));
  }

  async setExclusion(guildId: string, kind: "role" | "channel", refId: string, enabled: boolean): Promise<void> {
    if (!/^\d{15,25}$/.test(refId)) throw new Error("invalid_exclusion_ref");
    if (enabled) {
      await this.db.query(
        "INSERT INTO leveling_exclusions(guild_id,kind,ref_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [guildId,kind,refId]
      );
    } else {
      await this.db.query("DELETE FROM leveling_exclusions WHERE guild_id=$1 AND kind=$2 AND ref_id=$3", [guildId,kind,refId]);
    }
  }

  async leaderboard(guildId: string, limit = 10): Promise<Array<{ userId: string; xp: number; level: number }>> {
    const safe = Math.min(Math.max(Math.floor(limit),1),100);
    const result = await this.db.query<{ user_id: string; xp: string | number; level: number }>(
      "SELECT user_id,xp,level FROM leveling_users WHERE guild_id=$1 ORDER BY xp DESC,updated_at ASC LIMIT $2",
      [guildId,safe]
    );
    return result.rows.map((row) => ({ userId: row.user_id, xp: Number(row.xp), level: row.level }));
  }

  private async addXp(
    guildId: string,
    userId: string,
    amount: number,
    announceLevelUp: boolean,
    sourceMessage?: Message,
    fromVoice = false
  ): Promise<void> {
    const settings = await this.settings(guildId);
    let grant = Math.max(0, Math.floor(amount));
    if (grant <= 0) return;

    if (settings.dailyXpCap > 0) {
      const daily = await this.db.query<{ xp: string | number }>(
        "SELECT xp FROM leveling_daily_xp WHERE guild_id=$1 AND user_id=$2 AND day=CURRENT_DATE",
        [guildId,userId]
      );
      const used = Number(daily.rows[0]?.xp ?? 0);
      const remaining = Math.max(0, settings.dailyXpCap - used);
      if (remaining <= 0) return;
      grant = Math.min(grant, remaining);
    }

    const previous = await this.db.query<{ level: number }>(
      "SELECT level FROM leveling_users WHERE guild_id=$1 AND user_id=$2",
      [guildId,userId]
    );
    const previousLevel = previous.rows[0]?.level ?? 0;

    const result = await this.db.query<{ xp: string | number; level: number }>(
      fromVoice
        ? `INSERT INTO leveling_users(guild_id,user_id,xp,level,voice_xp)
           VALUES($1,$2,$3,0,$3)
           ON CONFLICT(guild_id,user_id) DO UPDATE SET
             xp=leveling_users.xp+EXCLUDED.xp,
             voice_xp=leveling_users.voice_xp+EXCLUDED.voice_xp,
             updated_at=now()
           RETURNING xp,level`
        : `INSERT INTO leveling_users(guild_id,user_id,xp,level,text_xp)
           VALUES($1,$2,$3,0,$3)
           ON CONFLICT(guild_id,user_id) DO UPDATE SET
             xp=leveling_users.xp+EXCLUDED.xp,
             text_xp=leveling_users.text_xp+EXCLUDED.text_xp,
             updated_at=now()
           RETURNING xp,level`,
      [guildId, userId, grant]
    );

    const row = result.rows[0];
    if (!row) return;

    const currentXp = Number(row.xp);
    if (!Number.isSafeInteger(currentXp) || currentXp < 0) return;
    const nextLevel = Math.floor(Math.sqrt(currentXp / 100));
    if (nextLevel <= row.level) return;

    const claimed = await this.db.query<{ level: number }>(
      "UPDATE leveling_users SET level=$1,updated_at=now() WHERE guild_id=$2 AND user_id=$3 AND level < $1 RETURNING level",
      [nextLevel, guildId, userId]
    );

    await this.db.query(
      "INSERT INTO leveling_daily_xp(guild_id,user_id,day,xp) VALUES($1,$2,CURRENT_DATE,$3) ON CONFLICT(guild_id,user_id,day) DO UPDATE SET xp=leveling_daily_xp.xp+EXCLUDED.xp,updated_at=now()",
      [guildId,userId,grant]
    );

    if (!claimed.rows[0] || nextLevel <= previousLevel) return;

    await this.applyRewards(guildId,userId,previousLevel,nextLevel);
    if (!announceLevelUp) return;

    if (sourceMessage && "send" in sourceMessage.channel) {
      await sourceMessage.channel.send(
        `🎉 <@${userId}> достиг уровня **${nextLevel}**!`
      ).catch((error) => {
        logger.warn("Leveling announcement failed", {
          guildId,
          userId,
          level: nextLevel,
          error: String(error)
        });
      });
    }
  }

  private async applyRewards(guildId: string, userId: string, previousLevel: number, nextLevel: number): Promise<void> {
    const rewards = await this.db.query<{
      level: number;
      role_id: string;
      remove_previous: boolean;
      dm_user: boolean;
      message: string;
    }>(
      "SELECT level,role_id,remove_previous,dm_user,message FROM leveling_rewards WHERE guild_id=$1 AND level>$2 AND level<=$3 ORDER BY level ASC",
      [guildId,previousLevel,nextLevel]
    );

    const guild = this.client?.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    for (const reward of rewards.rows) {
      const role = guild.roles.cache.get(reward.role_id);
      if (!role || role.managed || role.position >= (guild.members.me?.roles.highest.position ?? -1)) {
        logger.warn("Level reward role is not manageable", { guildId,userId,roleId:reward.role_id,level:reward.level });
        continue;
      }

      if (reward.remove_previous) {
        const previousRewards = await this.db.query<{ role_id: string }>(
          "SELECT role_id FROM leveling_rewards WHERE guild_id=$1 AND level<$2 ORDER BY level DESC",
          [guildId,reward.level]
        );
        for (const previous of previousRewards.rows) {
          const previousRole = guild.roles.cache.get(previous.role_id);
          if (previousRole && member.roles.cache.has(previousRole.id)) {
            await member.roles.remove(previousRole).catch((error) =>
              logger.warn("Failed to remove previous level reward", {
                guildId,userId,roleId:previousRole.id,error:String(error)
              })
            );
          }
        }
      }

      await member.roles.add(role).catch((error) =>
        logger.warn("Failed to add level reward", { guildId,userId,roleId:role.id,error:String(error) })
      );

      if (reward.dm_user) {
        const message = reward.message || "Поздравляем! Ты достиг уровня {level}.";
        await member.user.send(message.replaceAll("{level}",String(reward.level))).catch(() => undefined);
      }
    }
  }

  private pruneCooldowns(now: number): void {
    const cutoff = now - 3_600_000;
    for (const [key, timestamp] of this.cooldowns) {
      if (timestamp < cutoff) this.cooldowns.delete(key);
    }

    const maxKeys = 10_000;
    if (this.cooldowns.size <= maxKeys) return;
    const oldest = [...this.cooldowns.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, this.cooldowns.size - maxKeys);
    for (const [key] of oldest) this.cooldowns.delete(key);
    logger.warn("Leveling cooldown cache trimmed", {
      removed: oldest.length,
      remaining: this.cooldowns.size
    });
  }
}
