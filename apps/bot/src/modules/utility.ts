import {
  ChannelType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type Role,
  type User
} from "discord.js";
import type { AuditLog } from "../audit.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

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
  private auditLog?: AuditLog;
  private readonly activeAfk = new Set<string>();
  private unsubscribe?: () => void;
  private messageUnsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;
    const existing = await this.db.query<{ guild_id: string; user_id: string }>(
      "SELECT guild_id,user_id FROM afk_users"
    );
    for (const row of existing.rows) {
      this.activeAfk.add(afkKey(row.guild_id, row.user_id));
    }
    this.unsubscribe = context.events.on(
      "interaction.command",
      (interaction) => this.handleSlash(interaction)
    );
    this.messageUnsubscribe = context.events.on(
      "message.create",
      (message) => this.handleMessage(message)
    );
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.messageUnsubscribe?.();
    this.unsubscribe = undefined;
    this.messageUnsubscribe = undefined;
    this.activeAfk.clear();
    this.auditLog = undefined;
    this.client = undefined;
  }

  async handlePrefixCommand(
    message: Message,
    commandName: string,
    args: string[]
  ): Promise<boolean> {
    if (!message.guild || message.author.bot || !INFO_COMMANDS.has(commandName)) {
      return false;
    }

    if (!await moduleEnabled(this.db, message.guild.id, "utility", true)) {
      await message.reply("Модуль Utility выключен.");
      return true;
    }

    switch (commandName) {
      case "serverinfo":
        await message.reply({ embeds: [this.buildServerInfo(message.guild)] });
        return true;

      case "userinfo": {
        const user =
          message.mentions.users.first() ??
          await this.fetchUser(args[0]);

        if (!user) {
          await message.reply("Укажи пользователя: @user или ID.");
          return true;
        }

        await message.reply({
          embeds: [await this.buildUserInfo(message.guild, user)]
        });
        return true;
      }

      case "avatar": {
        const user =
          message.mentions.users.first() ??
          await this.fetchUser(args[0]) ??
          message.author;

        await message.reply({
          content: `🖼️ Аватар **${user.globalName ?? user.username}**:\n${user.displayAvatarURL({
            size: 1024,
            extension: "png",
            forceStatic: false
          })}`
        });
        return true;
      }

      case "membercount":
        await message.reply(
          `👥 Участников: **${message.guild.memberCount.toLocaleString("ru-RU")}**`
        );
        return true;

      case "roleinfo": {
        const role =
          message.mentions.roles.first() ??
          message.guild.roles.cache.get(args[0] ?? "");

        if (!role) {
          await message.reply("Укажи роль: @роль или ID.");
          return true;
        }

        await message.reply({ embeds: [this.buildRoleInfo(role)] });
        return true;
      }

      case "channelinfo": {
        await message.reply({
          embeds: [this.buildChannelInfo(message.channel)]
        });
        return true;
      }

      case "afk":
        if (["off", "clear", "remove"].includes(
          (args[0] ?? "").toLowerCase()
        )) {
          const cleared = await this.clearAfk(
            message.guild.id,
            message.author.id
          );
          await message.reply(
            cleared
              ? "✅ AFK-состояние снято."
              : "У тебя нет активного AFK."
          );
          return true;
        }

        await this.setAfk(
          message.guild.id,
          message.author.id,
          normalizeAfkReason(args.join(" "))
        );
        await message.reply(
          "💤 AFK включён. Любое следующее сообщение автоматически снимет статус."
        );
        return true;
    }

    return false;
  }

  private async handleSlash(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.inGuild() || !INFO_COMMANDS.has(interaction.commandName)) {
      return;
    }

    if (!await moduleEnabled(this.db, interaction.guild!.id, "utility", true)) {
      await interaction.reply({
        content: "Модуль Utility выключен.",
        ephemeral: true
      });
      return;
    }

    switch (interaction.commandName) {
      case "serverinfo":
        await interaction.reply({
          embeds: [this.buildServerInfo(interaction.guild!)]
        });
        return;

      case "userinfo": {
        const user = interaction.options.getUser("user") ?? interaction.user;
        await interaction.reply({
          embeds: [await this.buildUserInfo(interaction.guild!, user)]
        });
        return;
      }

      case "avatar": {
        const user = interaction.options.getUser("user") ?? interaction.user;
        await interaction.reply({
          content: `🖼️ Аватар **${user.globalName ?? user.username}**:\n${user.displayAvatarURL({
            size: 1024,
            extension: "png",
            forceStatic: false
          })}`
        });
        return;
      }

      case "membercount":
        await interaction.reply({
          content: `👥 Участников: **${interaction.guild!.memberCount.toLocaleString("ru-RU")}**`
        });
        return;

      case "roleinfo":
        await interaction.reply({
          embeds: [
            this.buildRoleInfo(interaction.options.getRole("role", true))
          ]
        });
        return;

      case "channelinfo": {
        const channel =
          interaction.options.getChannel("channel") ?? interaction.channel;

        if (!channel || !isGuildChannelLike(channel)) {
          await interaction.reply({
            content: "Канал не найден.",
            ephemeral: true
          });
          return;
        }

        await interaction.reply({
          embeds: [this.buildChannelInfo(channel)]
        });
        return;
      }

      case "afk": {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "set") {
          await this.setAfk(
            interaction.guild!.id,
            interaction.user.id,
            normalizeAfkReason(
              interaction.options.getString("reason") ?? ""
            )
          );
          await interaction.reply({
            content:
              "💤 AFK включён. Следующее сообщение автоматически снимет статус.",
            ephemeral: true
          });
          return;
        }

        if (subcommand === "clear") {
          const cleared = await this.clearAfk(
            interaction.guild!.id,
            interaction.user.id
          );
          await interaction.reply({
            content: cleared
              ? "✅ AFK-состояние снято."
              : "У тебя нет активного AFK.",
            ephemeral: true
          });
          return;
        }

        const current = await this.getAfk(
          interaction.guild!.id,
          interaction.user.id
        );
        await interaction.reply({
          content: current
            ? `💤 Ты AFK с <t:${Math.floor(current.createdAt.getTime() / 1000)}:R>. Причина: ${current.reason}`
            : "Сейчас AFK не включён.",
          allowedMentions: { parse: [] },
          ephemeral: true
        });
        return;
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (!await moduleEnabled(this.db, message.guild.id, "utility", true)) {
      return;
    }

    if (
      isPotentialAfkPrefixCommand(message.content)
    ) return;

    const ownKey = afkKey(message.guild.id, message.author.id);
    if (this.activeAfk.has(ownKey)) {
      await this.clearAfk(message.guild.id, message.author.id);
      await message.reply(
        "👋 Ты снова активен — AFK-состояние снято."
      ).catch(() => undefined);
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
      `💤 <@${row.user_id}> сейчас AFK (${formatAfkDuration(
        new Date(row.created_at)
      )}): ${row.reason}`
    );

    await message.reply(lines.join("\n")).catch(() => undefined);
  }

  private async setAfk(
    guildId: string,
    userId: string,
    reason: string
  ): Promise<void> {
    const normalizedReason = normalizeAfkReason(reason);
    await this.db.query(
      `INSERT INTO afk_users(guild_id,user_id,reason,created_at)
       VALUES($1,$2,$3,now())
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET reason=EXCLUDED.reason,created_at=now()`,
      [guildId, userId, normalizedReason]
    );
    this.activeAfk.add(afkKey(guildId, userId));
    await this.auditLog?.record({
      guildId,
      actorUserId: userId,
      source: "discord",
      action: "utility.afk.set",
      targetType: "user",
      targetId: userId,
      metadata: { reason: normalizedReason }
    });
  }

  private async clearAfk(guildId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM afk_users WHERE guild_id=$1 AND user_id=$2",
      [guildId, userId]
    );
    this.activeAfk.delete(afkKey(guildId, userId));
    if (result.rowCount === 1) {
      await this.auditLog?.record({
        guildId,
        actorUserId: userId,
        source: "discord",
        action: "utility.afk.clear",
        targetType: "user",
        targetId: userId
      });
    }
    return result.rowCount === 1;
  }

  private async getAfk(
    guildId: string,
    userId: string
  ): Promise<AfkRecord | null> {
    const result = await this.db.query<{
      user_id: string;
      reason: string;
      created_at: Date | string;
    }>(
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

  private buildServerInfo(guild: Guild): EmbedBuilder {
    const textChannels = guild.channels.cache.filter(
      (channel) =>
        channel.type !== ChannelType.GuildCategory &&
        channel.isTextBased()
    ).size;
    const voiceChannels = guild.channels.cache.filter((channel) =>
      channel.isVoiceBased()
    ).size;
    const categories = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildCategory
    ).size;
    const roles = Math.max(guild.roles.cache.size - 1, 0);

    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setDescription(`ID: \`${guild.id}\``)
      .addFields(
        {
          name: "👥 Участники",
          value: guild.memberCount.toLocaleString("ru-RU"),
          inline: true
        },
        { name: "🎭 Роли", value: String(roles), inline: true },
        {
          name: "📝 Текстовые",
          value: String(textChannels),
          inline: true
        },
        {
          name: "🔊 Голосовые",
          value: String(voiceChannels),
          inline: true
        },
        {
          name: "📁 Категории",
          value: String(categories),
          inline: true
        },
        {
          name: "🚀 Бусты",
          value: String(guild.premiumSubscriptionCount ?? 0),
          inline: true
        },
        {
          name: "👑 Владелец",
          value: `<@${guild.ownerId}>`,
          inline: true
        },
        {
          name: "📆 Создан",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
          inline: true
        }
      )
      .setFooter({
        text: `Уровень верификации: ${String(guild.verificationLevel)}`
      });

    const icon = guild.iconURL({ size: 512 });
    if (icon) embed.setThumbnail(icon);

    return embed;
  }

  private async buildUserInfo(
    guild: Guild,
    user: User
  ): Promise<EmbedBuilder> {
    const member = await guild.members.fetch(user.id).catch(() => null);
    const roleLines = member
      ? [...member.roles.cache.values()]
          .filter((role) => role.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .slice(0, 10)
          .map((role) => role.toString())
      : [];

    const embed = new EmbedBuilder()
      .setTitle(user.globalName ?? user.username)
      .setDescription(`ID: \`${user.id}\``)
      .setThumbnail(user.displayAvatarURL({ size: 512 }))
      .addFields(
        {
          name: "👤 Username",
          value: `@${user.username}`,
          inline: true
        },
        {
          name: "📆 Создан",
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`,
          inline: true
        },
        {
          name: "🎭 Роли",
          value: roleLines.length
            ? roleLines.join(" ")
            : "Только @everyone",
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

    return embed;
  }

  private buildRoleInfo(role: Role): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(role.name)
      .setDescription(
        `${role.toString()} · ID: \`${role.id}\``
      )
      .addFields(
        {
          name: "Позиция",
          value: String(role.position),
          inline: true
        },
        {
          name: "Упоминаемая",
          value: role.mentionable ? "Да" : "Нет",
          inline: true
        },
        {
          name: "Управляемая",
          value: role.managed ? "Да" : "Нет",
          inline: true
        },
        {
          name: "Участников",
          value: role.members.size.toLocaleString("ru-RU"),
          inline: true
        },
        {
          name: "Цвет",
          value: role.hexColor,
          inline: true
        }
      );
  }

  private buildChannelInfo(
    channel: GuildBasedChannel
  ): EmbedBuilder {
    const position =
      "rawPosition" in channel && typeof channel.rawPosition === "number"
        ? String(channel.rawPosition)
        : "—";

    return new EmbedBuilder()
      .setTitle(channel.name)
      .setDescription(
        `ID: \`${channel.id}\`\nТип: \`${String(channel.type)}\``
      )
      .addFields(
        {
          name: "Категория",
          value: channel.parentId ? `<#${channel.parentId}>` : "Нет",
          inline: true
        },
        { name: "Позиция", value: position, inline: true }
      );
  }
}

function isGuildChannelLike(
  value: unknown
): value is GuildBasedChannel {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    "name" in value &&
    "type" in value
  );
}

export function normalizeAfkReason(value: string): string {
  return value.trim().slice(0, 300) || "Отошёл";
}

export function formatAfkDuration(
  createdAt: Date,
  now = Date.now()
): string {
  const deltaSeconds = Math.max(
    0,
    Math.floor((now - createdAt.getTime()) / 1000)
  );
  if (deltaSeconds < 60) return `${deltaSeconds}с`;

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}м`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}ч`;

  return `${Math.floor(hours / 24)}д`;
}


function afkKey(guildId: string, userId: string): string {
  return guildId + ":" + userId;
}

function isPotentialAfkPrefixCommand(content: string): boolean {
  return /^.{1,5}afk(?:\s|$)/i.test(content.trim());
}
