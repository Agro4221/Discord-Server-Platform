import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type User
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type AfkRecord = {
  userId: string;
  reason: string;
  createdAt: Date;
};

const INFO_COMMANDS = new Set([
  "serverinfo",
  "userinfo",
  "avatar",
  "membercount",
  "roleinfo",
  "channelinfo",
  "afk"
]);

export class Utility implements PlatformModule {
  readonly name = "utility";

  private client?: Client;
  private unsubscribe?: () => void;
  private messageUnsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const interactionUnsubscribe = context.events.on(
      "interaction.command",
      (interaction) => this.handleSlash(interaction)
    );
    const messageUnsubscribe = context.events.on(
      "message.create",
      (message) => this.handleMessage(message)
    );

    this.unsubscribe = interactionUnsubscribe;
    this.messageUnsubscribe = messageUnsubscribe;
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.messageUnsubscribe?.();
    this.unsubscribe = undefined;
    this.messageUnsubscribe = undefined;
    this.client = undefined;
  }

  async handlePrefixCommand(
    message: Message,
    commandName: string,
    args: string[]
  ): Promise<boolean> {
    if (!message.guild || message.author.bot || !INFO_COMMANDS.has(commandName)) return false;
    if (!await moduleEnabled(this.db, message.guild.id, "utility", true)) {
      await message.reply("Модуль Utility выключен.");
      return true;
    }

    switch (commandName) {
      case "serverinfo":
        await this.sendServerInfo(message, message.guild);
        return true;
      case "userinfo": {
        const user = message.mentions.users.first() ?? await this.fetchUser(args[0]);
        if (!user) {
          await message.reply("Укажи пользователя: @user или ID.");
          return true;
        }
        await this.sendUserInfo(message, user);
        return true;
      }
      case "avatar": {
        const user = message.mentions.users.first() ?? await this.fetchUser(args[0]) ?? message.author;
        await this.sendAvatar(message, user);
        return true;
      }
      case "membercount":
        await message.reply(`👥 Участников: **${message.guild.memberCount.toLocaleString("ru-RU")}**`);
        return true;
      case "roleinfo": {
        const role = message.mentions.roles.first()
          ?? message.guild.roles.cache.get(args[0] ?? "")
          ?? null;
        if (!role) {
          await message.reply("Укажи роль: @роль или ID.");
          return true;
        }
        await this.sendRoleInfo(message, role);
        return true;
      }
      case "channelinfo":
        await this.sendChannelInfo(message, message.channel);
        return true;
      case "afk":
        if (["off", "clear", "remove"].includes((args[0] ?? "").toLowerCase())) {
          const cleared = await this.clearAfk(message.guild.id, message.author.id);
          await message.reply(cleared ? "✅ AFK-состояние снято." : "У тебя нет активного AFK.");
          return true;
        }
        await this.setAfk(message.guild.id, message.author.id, args.join(" ").trim() || "Отошёл");
        await message.reply("💤 AFK включён. Любое следующее сообщение автоматически снимет статус.");
        return true;
    }

    return false;
  }

  private async handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !INFO_COMMANDS.has(interaction.commandName)) return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "utility", true)) {
      await interaction.reply({ content: "Модуль Utility выключен.", ephemeral: true });
      return;
    }

    try {
      switch (interaction.commandName) {
        case "serverinfo":
          await this.sendServerInfo(interaction, interaction.guild!);
          return;
        case "userinfo": {
          const user = interaction.options.getUser("user") ?? interaction.user;
          await this.sendUserInfo(interaction, user);
          return;
        }
        case "avatar": {
          const user = interaction.options.getUser("user") ?? interaction.user;
          await this.sendAvatar(interaction, user);
          return;
        }
        case "membercount":
          await interaction.reply({
            content: `👥 Участников: **${interaction.guild!.memberCount.toLocaleString("ru-RU")}**`
          });
          return;
        case "roleinfo": {
          const role = interaction.options.getRole("role", true);
          await this.sendRoleInfo(interaction, role);
          return;
        }
        case "channelinfo": {
          const channel = interaction.options.getChannel("channel") ?? interaction.channel;
          if (!channel) {
            await interaction.reply({ content: "Канал не найден.", ephemeral: true });
            return;
          }
          await this.sendChannelInfo(interaction, channel);
          return;
        }
        case "afk": {
          const subcommand = interaction.options.getSubcommand();
          if (subcommand === "set") {
            const reason = interaction.options.getString("reason") ?? "Отошёл";
            await this.setAfk(interaction.guild!.id, interaction.user.id, reason);
            await interaction.reply({
              content: "💤 AFK включён. Следующее сообщение автоматически снимет статус.",
              ephemeral: true
            });
            return;
          }

          if (subcommand === "clear") {
            const cleared = await this.clearAfk(interaction.guild!.id, interaction.user.id);
            await interaction.reply({
              content: cleared ? "✅ AFK-состояние снято." : "У тебя нет активного AFK.",
              ephemeral: true
            });
            return;
          }

          const current = await this.getAfk(interaction.guild!.id, interaction.user.id);
          await interaction.reply({
            content: current
              ? `💤 Ты AFK с <t:${Math.floor(current.createdAt.getTime() / 1000)}:R>. Причина: ${current.reason}`
              : "Сейчас AFK не включён.",
            ephemeral: true
          });
          return;
        }
      }
    } catch (error) {
      logger.warn("Utility command failed", {
        command: interaction.commandName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        error: String(error)
      });
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Не удалось выполнить команду.", ephemeral: true });
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "utility", true)) return;

    if (await this.isAfkPrefixCommand(message)) return;

    const ownAfk = await this.getAfk(message.guild.id, message.author.id);
    if (ownAfk) {
      await this.clearAfk(message.guild.id, message.author.id);
      await message.reply("👋 Ты снова активен — AFK-состояние снято.").catch((error) => {
        logger.debug?.("AFK return response failed", { error: String(error) });
      });
    }

    const mentionedIds = [...message.mentions.users.keys()]
      .filter((id) => id !== message.author.id)
      .slice(0, 10);
    if (mentionedIds.length === 0) return;

    const result = await this.db.query<{
      user_id: string;
      reason: string;
      created_at: Date | string;
    }>(
      "SELECT user_id,reason,created_at FROM afk_users WHERE guild_id=$1 AND user_id=ANY($2::text[])",
      [message.guild.id, mentionedIds]
    );
    if (result.rows.length === 0) return;

    const lines = result.rows.map((row) =>
      `💤 <@${row.user_id}> сейчас AFK (${formatAfkDuration(new Date(row.created_at))}): ${row.reason}`
    );
    await message.reply(lines.join("\n")).catch((error) => {
      logger.debug?.("AFK mention response failed", { error: String(error) });
    });
  }

  private async isAfkPrefixCommand(message: Message): Promise<boolean> {
    const result = await this.db.query<{ command_prefix: string }>(
      "SELECT command_prefix FROM guild_settings WHERE guild_id=$1",
      [message.guild!.id]
    );
    const prefix = result.rows[0]?.command_prefix || "!";
    if (!message.content.startsWith(prefix)) return false;
    const command = message.content.slice(prefix.length).trim().split(/\s+/, 1)[0]?.toLowerCase();
    return command === "afk";
  }

  private async setAfk(guildId: string, userId: string, reason: string): Promise<void> {
    const normalized = reason.trim().slice(0, 300) || "Отошёл";
    await this.db.query(
      `INSERT INTO afk_users(guild_id,user_id,reason,created_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET reason=EXCLUDED.reason,created_at=now()`,
      [guildId, userId, normalized]
    );
  }

  private async clearAfk(guildId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM afk_users WHERE guild_id=$1 AND user_id=$2",
      [guildId, userId]
    );
    return result.rowCount === 1;
  }

  private async getAfk(guildId: string, userId: string): Promise<AfkRecord | null> {
    const result = await this.db.query<{ user_id: string; reason: string; created_at: Date | string }>(
      "SELECT user_id,reason,created_at FROM afk_users WHERE guild_id=$1 AND user_id=$2",
      [guildId, userId]
    );
    const row = result.rows[0];
    return row
      ? {
          userId: row.user_id,
          reason: row.reason,
          createdAt: new Date(row.created_at)
        }
      : null;
  }

  private async fetchUser(value?: string): Promise<User | null> {
    if (!value || !this.client || !/^\d{15,25}$/.test(value)) return null;
    return this.client.users.fetch(value).catch(() => null);
  }

  private async sendServerInfo(
    target: { reply(payload: unknown): Promise<unknown> },
    guild: import("discord.js").Guild
  ): Promise<void> {
    const textChannels = guild.channels.cache.filter((channel) => channel.isTextBased()).size;
    const voiceChannels = guild.channels.cache.filter((channel) => channel.isVoiceBased()).size;
    const categories = guild.channels.cache.filter((channel) => channel.type === 4).size;
    const roles = Math.max(guild.roles.cache.size - 1, 0);

    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setDescription(`ID: \`${guild.id}\``)
      .setThumbnail(guild.iconURL({ size: 512 }) ?? null)
      .addFields(
        { name: "👥 Участники", value: guild.memberCount.toLocaleString("ru-RU"), inline: true },
        { name: "🎭 Роли", value: String(roles), inline: true },
        { name: "📝 Текстовые", value: String(textChannels), inline: true },
        { name: "🔊 Голосовые", value: String(voiceChannels), inline: true },
        { name: "📁 Категории", value: String(categories), inline: true },
        { name: "🚀 Бусты", value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
        { name: "👑 Владелец", value: `<@${guild.ownerId}>`, inline: true },
        { name: "📆 Создан", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true }
      )
      .setFooter({ text: `Уровень верификации: ${String(guild.verificationLevel)}` });

    await target.reply({ embeds: [embed] });
  }

  private async sendUserInfo(
    target: { reply(payload: unknown): Promise<unknown> },
    user: User
  ): Promise<void> {
    const guildId = "guild" in target && (target as { guild?: { id: string } }).guild?.id;
    const member = guildId
      ? await this.client?.guilds.cache.get(guildId)?.members.fetch(user.id).catch(() => null)
      : null;

    const roleLines = member
      ? [...member.roles.cache.values()]
          .filter((role) => role.id !== guildId)
          .sort((a, b) => b.position - a.position)
          .slice(0, 10)
          .map((role) => role.toString())
      : [];

    const embed = new EmbedBuilder()
      .setTitle(user.globalName ?? user.username)
      .setDescription(`ID: \`${user.id}\``)
      .setThumbnail(user.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: "👤 Username", value: `@${user.username}`, inline: true },
        { name: "📆 Создан", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
        {
          name: "🎭 Роли",
          value: roleLines.length ? roleLines.join(" ") : "Только @everyone",
          inline: false
        }
      );

    if (member?.joinedTimestamp) {
      embed.addFields({
        name: "📥 На сервере с",
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,
        inline: true
      });
    }

    await target.reply({ embeds: [embed] });
  }

  private async sendAvatar(
    target: { reply(payload: unknown): Promise<unknown> },
    user: User
  ): Promise<void> {
    await target.reply({
      content: `🖼️ Аватар **${user.globalName ?? user.username}**:\n${user.displayAvatarURL({ size: 1024, extension: "png", forceStatic: false })}`
    });
  }

  private async sendRoleInfo(
    target: { reply(payload: unknown): Promise<unknown> },
    role: import("discord.js").Role
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle(role.name)
      .setDescription(`${role.toString()} · ID: \`${role.id}\``)
      .addFields(
        { name: "Позиция", value: String(role.position), inline: true },
        { name: "Упоминаемая", value: role.mentionable ? "Да" : "Нет", inline: true },
        { name: "Управляемая", value: role.managed ? "Да" : "Нет", inline: true },
        { name: "Участников", value: role.members.size.toLocaleString("ru-RU"), inline: true },
        { name: "Цвет", value: role.hexColor, inline: true }
      );

    await target.reply({ embeds: [embed] });
  }

  private async sendChannelInfo(
    target: { reply(payload: unknown): Promise<unknown },
    channel: import("discord.js").GuildChannel
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle(channel.name)
      .setDescription(`ID: \`${channel.id}\`\nТип: \`${channel.type}\``)
      .addFields(
        { name: "Категория", value: channel.parent ? `<#${channel.parentId}>` : "Нет", inline: true },
        { name: "Позиция", value: String(channel.rawPosition), inline: true }
      );

    await target.reply({ embeds: [embed] });
  }
}

export function formatAfkDuration(createdAt: Date, now = Date.now()): string {
  const deltaSeconds = Math.max(0, Math.floor((now - createdAt.getTime()) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}с`;
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}ч`;
  return `${Math.floor(hours / 24)}д`;
}
