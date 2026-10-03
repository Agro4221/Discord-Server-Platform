import {
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type VoiceState
} from "discord.js";
import type { AuditLog } from "../audit.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type LoggingConfig = {
  enabled: boolean;
  channelId: string | null;
  messageDelete: boolean;
  messageEdit: boolean;
  memberJoin: boolean;
  memberLeave: boolean;
  memberUpdate: boolean;
  voice: boolean;
  channelDelete: boolean;
  roleDelete: boolean;
  bans: boolean;
};

const DEFAULTS: LoggingConfig = {
  enabled: false,
  channelId: null,
  messageDelete: true,
  messageEdit: true,
  memberJoin: true,
  memberLeave: true,
  memberUpdate: true,
  voice: true,
  channelDelete: true,
  roleDelete: true,
  bans: true
};

export class Logging implements PlatformModule {
  readonly name = "logging";
  private client?: Client;
  private auditLog?: AuditLog;
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;

    const unsubs = [
      context.events.on("message.delete", (message) => { void this.onMessageDelete(message); }),
      context.events.on("message.update", ({ oldMessage, newMessage }) => { void this.onMessageUpdate(oldMessage, newMessage); }),
      context.events.on("member.add", (member) => { void this.onMemberJoin(member); }),
      context.events.on("member.remove", (member) => { void this.onMemberLeave(member); }),
      context.events.on("member.update", ({ oldMember, newMember }) => { void this.onMemberUpdate(oldMember, newMember); }),
      context.events.on("voice.state", ({ oldState, newState }) => { void this.onVoice(oldState, newState); }),
      context.events.on("channel.delete", (channel) => { void this.onChannelDelete(channel); }),
      context.events.on("role.delete", (role) => { void this.onRoleDelete(role); }),
      context.events.on("member.ban", ({ guildId, userId }) => { void this.onBan(guildId, userId); }),
      context.events.on("member.unban", ({ guildId, userId }) => { void this.onUnban(guildId, userId); }),
      context.events.on("interaction.command", (interaction) => { void this.onCommand(interaction); })
    ];

    this.unsubscribe = () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
    this.auditLog = undefined;
  }

  async configure(guildId: string, patch: Partial<LoggingConfig>): Promise<LoggingConfig> {
    const current = await this.getConfig(guildId);
    const next = { ...current, ...patch };

    await this.db.query(
      "INSERT INTO logging_settings(guild_id,enabled,channel_id,message_delete,message_edit,member_join,member_leave,member_update,voice,channel_delete,role_delete,bans) " +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) " +
      "ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,message_delete=EXCLUDED.message_delete,message_edit=EXCLUDED.message_edit,member_join=EXCLUDED.member_join,member_leave=EXCLUDED.member_leave,member_update=EXCLUDED.member_update,voice=EXCLUDED.voice,channel_delete=EXCLUDED.channel_delete,role_delete=EXCLUDED.role_delete,bans=EXCLUDED.bans,updated_at=now()",
      [
        guildId,
        next.enabled,
        next.channelId,
        next.messageDelete,
        next.messageEdit,
        next.memberJoin,
        next.memberLeave,
        next.memberUpdate,
        next.voice,
        next.channelDelete,
        next.roleDelete,
        next.bans
      ]
    );

    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'logging',$2) " +
      "ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()",
      [guildId, next.enabled]
    );

    return next;
  }

  async getConfig(guildId: string): Promise<LoggingConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      channel_id: string | null;
      message_delete: boolean;
      message_edit: boolean;
      member_join: boolean;
      member_leave: boolean;
      member_update: boolean;
      voice: boolean;
      channel_delete: boolean;
      role_delete: boolean;
      bans: boolean;
    }>(
      "SELECT enabled,channel_id,message_delete,message_edit,member_join,member_leave,member_update,voice,channel_delete,role_delete,bans FROM logging_settings WHERE guild_id=$1",
      [guildId]
    );

    const row = result.rows[0];
    if (!row) return { ...DEFAULTS };

    return {
      enabled: row.enabled,
      channelId: row.channel_id,
      messageDelete: row.message_delete,
      messageEdit: row.message_edit,
      memberJoin: row.member_join,
      memberLeave: row.member_leave,
      memberUpdate: row.member_update,
      voice: row.voice,
      channelDelete: row.channel_delete,
      roleDelete: row.role_delete,
      bans: row.bans
    };
  }

  async handlePrefixCommand(message: Message, commandName: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot || commandName !== "logging") return false;

    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply("Нужны права Manage Server.");
      return true;
    }

    if ((args[0] ?? "").toLowerCase() !== "setup" || !args[1]) {
      await message.reply("Формат: !logging setup #канал");
      return true;
    }

    const channel = message.mentions.channels.first() ?? message.guild.channels.cache.get(args[1]);
    if (!channel?.isTextBased()) {
      await message.reply("Канал логов должен быть текстовым.");
      return true;
    }

    await this.configure(message.guild.id, {
      enabled: true,
      channelId: channel.id
    });

    await message.reply("✅ Logging настроен.");
    return true;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "logging") return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "Нужны права Manage Server.",
        ephemeral: true
      });
      return;
    }

    if (interaction.options.getSubcommand() !== "setup") return;

    const channelOption = interaction.options.getChannel("channel", true);
    const channel = interaction.guild!.channels.cache.get(channelOption.id);

    if (!channel?.isTextBased()) {
      await interaction.reply({
        content: "Канал логов должен быть текстовым.",
        ephemeral: true
      });
      return;
    }

    await this.configure(interaction.guildId!, {
      enabled: interaction.options.getBoolean("enabled") ?? true,
      channelId: channel.id
    });

    await interaction.reply({
      content: "Logging настроен.",
      ephemeral: true
    });
  }

  private async emit(
    guildId: string,
    action: string,
    title: string,
    description: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (!await moduleEnabled(this.db, guildId, "logging", false)) return;

    const config = await this.getConfig(guildId);
    if (!config.enabled || !config.channelId || !this.client) return;

    try {
      await this.auditLog?.record({
        guildId,
        source: "discord",
        action,
        metadata: { loggingEvent: true, ...metadata }
      });
    } catch {}

    const channel = this.client.channels.cache.get(config.channelId);
    if (!channel?.isTextBased() || !("send" in channel)) return;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description.slice(0, 4000))
          .setTimestamp()
      ]
    }).catch(() => undefined);
  }

  private async onMessageDelete(message: Message): Promise<void> {
    if (!message.guild || !message.content) return;

    const config = await this.getConfig(message.guild.id);
    if (!config.messageDelete) return;

    await this.emit(
      message.guild.id,
      "logging.message.delete",
      "🗑️ Сообщение удалено",
      "Автор: <@" + message.author.id + ">\\nКанал: <#" + message.channelId + ">\\n\\n" + message.content,
      { messageId: message.id, channelId: message.channelId, userId: message.author.id }
    );
  }

  private async onMessageUpdate(oldMessage: Message, newMessage: Message): Promise<void> {
    if (!newMessage.guild || oldMessage.content === newMessage.content) return;

    const config = await this.getConfig(newMessage.guild.id);
    if (!config.messageEdit) return;

    await this.emit(
      newMessage.guild.id,
      "logging.message.edit",
      "✏️ Сообщение изменено",
      "Автор: <@" + newMessage.author.id + ">\\nКанал: <#" + newMessage.channelId + ">\\nДо:\\n" +
        (oldMessage.content || "(пусто)") + "\\n\\nПосле:\\n" +
        (newMessage.content || "(пусто)"),
      { messageId: newMessage.id, channelId: newMessage.channelId, userId: newMessage.author.id }
    );
  }

  private async onMemberJoin(member: import("discord.js").GuildMember): Promise<void> {
    const config = await this.getConfig(member.guild.id);
    if (!config.memberJoin) return;

    await this.emit(
      member.guild.id,
      "logging.member.join",
      "📥 Участник вошёл",
      "Пользователь: <@" + member.id + ">\\nID: " + member.id,
      { userId: member.id }
    );
  }

  private async onMemberLeave(member: import("discord.js").GuildMember): Promise<void> {
    const config = await this.getConfig(member.guild.id);
    if (!config.memberLeave) return;

    await this.emit(
      member.guild.id,
      "logging.member.leave",
      "📤 Участник вышел",
      "Пользователь: <@" + member.id + ">\\nID: " + member.id,
      { userId: member.id }
    );
  }

  private async onMemberUpdate(
    oldMember: import("discord.js").GuildMember,
    newMember: import("discord.js").GuildMember
  ): Promise<void> {
    const config = await this.getConfig(newMember.guild.id);
    if (!config.memberUpdate) return;

    const changes: string[] = [];
    if (oldMember.nickname !== newMember.nickname) {
      changes.push(
        "Ник: " + (oldMember.nickname ?? "—") + " → " + (newMember.nickname ?? "—")
      );
    }

    if (!changes.length) return;

    await this.emit(
      newMember.guild.id,
      "logging.member.update",
      "👤 Участник изменён",
      "Пользователь: <@" + newMember.id + ">\\n" + changes.join("\\n"),
      { userId: newMember.id }
    );
  }

  private async onVoice(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const config = await this.getConfig(newState.guild.id);
    if (!config.voice || oldState.channelId === newState.channelId) return;

    const text = oldState.channelId && newState.channelId
      ? "Пользователь: <@" + newState.id + ">\\nПереместился: <#" + oldState.channelId + "> → <#" + newState.channelId + ">"
      : newState.channelId
        ? "Пользователь: <@" + newState.id + ">\\nВошёл: <#" + newState.channelId + ">"
        : "Пользователь: <@" + oldState.id + ">\\nВышел: <#" + oldState.channelId + ">";

    await this.emit(
      newState.guild.id,
      "logging.voice",
      "🔊 Voice activity",
      text,
      { userId: newState.id, before: oldState.channelId, after: newState.channelId }
    );
  }

  private async onChannelDelete(
    channel: import("discord.js").NonThreadGuildBasedChannel | import("discord.js").ThreadChannel
  ): Promise<void> {
    if (!channel.guildId) return;
    const config = await this.getConfig(channel.guildId);
    if (!config.channelDelete) return;

    await this.emit(
      channel.guildId,
      "logging.channel.delete",
      "🗑️ Канал удалён",
      "Канал: " + (channel.name ?? channel.id) + "\\nID: " + channel.id,
      { channelId: channel.id }
    );
  }

  private async onRoleDelete(
    role: import("discord.js").Role
  ): Promise<void> {
    const config = await this.getConfig(role.guild.id);
    if (!config.roleDelete) return;

    await this.emit(
      role.guild.id,
      "logging.role.delete",
      "🎭 Роль удалена",
      "Роль: " + role.name + "\\nID: " + role.id,
      { roleId: role.id, roleName: role.name }
    );
  }

  private async onBan(guildId: string, userId: string): Promise<void> {
    const config = await this.getConfig(guildId);
    if (!config.bans) return;

    await this.emit(
      guildId,
      "logging.member.ban",
      "🔨 Участник заблокирован",
      "Пользователь: <@" + userId + ">\\nID: " + userId,
      { userId }
    );
  }

  private async onUnban(guildId: string, userId: string): Promise<void> {
    const config = await this.getConfig(guildId);
    if (!config.bans) return;

    await this.emit(
      guildId,
      "logging.member.unban",
      "🔓 Блокировка снята",
      "Пользователь: <@" + userId + ">\\nID: " + userId,
      { userId }
    );
  }
}
