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
  messageBulkDelete: boolean;
  reactions: boolean;
  memberJoin: boolean;
  memberLeave: boolean;
  memberUpdate: boolean;
  voice: boolean;
  channelDelete: boolean;
  channelUpdate: boolean;
  roleDelete: boolean;
  roleUpdate: boolean;
  bans: boolean;
};

const DEFAULTS: LoggingConfig = {
  enabled: false,
  channelId: null,
  messageDelete: true,
  messageEdit: true,
  messageBulkDelete: true,
  reactions: true,
  memberJoin: true,
  memberLeave: true,
  memberUpdate: true,
  voice: true,
  channelDelete: true,
  channelUpdate: true,
  roleDelete: true,
  roleUpdate: true,
  bans: true
};

export class Logging implements PlatformModule {
  readonly name = "logging";
  private client?: Client;
  private auditLog?: AuditLog;
  private unsubscribe?: () => void;
  private readonly configCache = new Map<string, LoggingConfigCacheEntry>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;

    const unsubs = [
      context.events.on("message.delete", (message) => { void this.onMessageDelete(message); }),
      context.events.on("message.update", ({ oldMessage, newMessage }) => { void this.onMessageUpdate(oldMessage, newMessage); }),
      context.events.on("message.bulk-delete", ({ guildId, channelId, messages }) => { void this.onMessageBulkDelete(guildId, channelId, messages); }),
      context.events.on("reaction.add", ({ reaction, user }) => { void this.onReaction(reaction, user, "add"); }),
      context.events.on("reaction.remove", ({ reaction, user }) => { void this.onReaction(reaction, user, "remove"); }),
      context.events.on("member.add", (member) => { void this.onMemberJoin(member); }),
      context.events.on("member.remove", (member) => { void this.onMemberLeave(member); }),
      context.events.on("member.update", ({ oldMember, newMember }) => { void this.onMemberUpdate(oldMember, newMember); }),
      context.events.on("voice.state", ({ oldState, newState }) => { void this.onVoice(oldState, newState); }),
      context.events.on("channel.create", (channel) => { void this.onChannelCreate(channel); }),
      context.events.on("channel.delete", (channel) => { void this.onChannelDelete(channel); }),
      context.events.on("channel.update", ({ oldChannel, newChannel }) => { void this.onChannelUpdate(oldChannel, newChannel); }),
      context.events.on("role.create", (role) => { void this.onRoleCreate(role); }),
      context.events.on("role.delete", (role) => { void this.onRoleDelete(role); }),
      context.events.on("role.update", ({ oldRole, newRole }) => { void this.onRoleUpdate(oldRole, newRole); }),
      context.events.on("member.ban", ({ guildId, userId }) => { void this.onBan(guildId, userId); }),
      context.events.on("member.unban", ({ guildId, userId }) => { void this.onUnban(guildId, userId); }),
      context.events.on("interaction.command", (interaction) => { void this.executeSlashCommand(interaction); })
    ];

    this.unsubscribe = () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
    this.auditLog = undefined;
    this.configCache.clear();
  }

  async configure(guildId: string, patch: Partial<LoggingConfig>): Promise<LoggingConfig> {
    const current = await this.getConfig(guildId);
    const next = { ...current, ...patch };

    await this.db.query(
      "INSERT INTO logging_settings(guild_id,enabled,channel_id,message_delete,message_edit,message_bulk_delete,reactions,member_join,member_leave,member_update,voice,channel_delete,channel_update,role_delete,role_update,bans) " +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) " +
      "ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,channel_id=EXCLUDED.channel_id,message_delete=EXCLUDED.message_delete,message_edit=EXCLUDED.message_edit,message_bulk_delete=EXCLUDED.message_bulk_delete,reactions=EXCLUDED.reactions,member_join=EXCLUDED.member_join,member_leave=EXCLUDED.member_leave,member_update=EXCLUDED.member_update,voice=EXCLUDED.voice,channel_delete=EXCLUDED.channel_delete,channel_update=EXCLUDED.channel_update,role_delete=EXCLUDED.role_delete,role_update=EXCLUDED.role_update,bans=EXCLUDED.bans,updated_at=now()",
      [
        guildId,
        next.enabled,
        next.channelId,
        next.messageDelete,
        next.messageEdit,
        next.messageBulkDelete,
        next.reactions,
        next.memberJoin,
        next.memberLeave,
        next.memberUpdate,
        next.voice,
        next.channelDelete,
        next.channelUpdate,
        next.roleDelete,
        next.roleUpdate,
        next.bans
      ]
    );

    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,'logging',$2) " +
      "ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()",
      [guildId, next.enabled]
    );

    this.configCache.set(guildId, {
      config: next,
      expiresAt: Date.now() + CONFIG_CACHE_TTL_MS
    });
    return next;
  }

  async getConfig(guildId: string): Promise<LoggingConfig> {
    const now = Date.now();
    const cached = this.configCache.get(guildId);
    if (cached && cached.expiresAt > now) return cached.config;

    const result = await this.db.query<{
      enabled: boolean;
      channel_id: string | null;
      message_delete: boolean;
      message_edit: boolean;
      message_bulk_delete: boolean;
      reactions: boolean;
      member_join: boolean;
      member_leave: boolean;
      member_update: boolean;
      voice: boolean;
      channel_delete: boolean;
      channel_update: boolean;
      role_delete: boolean;
      role_update: boolean;
      bans: boolean;
    }>(
      "SELECT enabled,channel_id,message_delete,message_edit,message_bulk_delete,reactions,member_join,member_leave,member_update,voice,channel_delete,channel_update,role_delete,role_update,bans FROM logging_settings WHERE guild_id=$1",
      [guildId]
    );

    const row = result.rows[0];
    if (!row) {
      const config = { ...DEFAULTS };
      this.configCache.set(guildId, {
        config,
        expiresAt: now + CONFIG_CACHE_TTL_MS
      });
      return config;
    }

    const config: LoggingConfig = {
      enabled: row.enabled,
      channelId: row.channel_id,
      messageDelete: row.message_delete,
      messageEdit: row.message_edit,
      messageBulkDelete: row.message_bulk_delete,
      reactions: row.reactions,
      memberJoin: row.member_join,
      memberLeave: row.member_leave,
      memberUpdate: row.member_update,
      voice: row.voice,
      channelDelete: row.channel_delete,
      channelUpdate: row.channel_update,
      roleDelete: row.role_delete,
      roleUpdate: row.role_update,
      bans: row.bans
    };
    this.configCache.set(guildId, {
      config,
      expiresAt: now + CONFIG_CACHE_TTL_MS
    });
    return config;
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

  async executeSlashCommand(interaction: ChatInputCommandInteraction, commandName = interaction.commandName): Promise<void> {
    if (!interaction.inGuild() || commandName !== "logging") return;

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
    if (!config.channelId || !this.client) return;

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

  private async onMessageBulkDelete(guildId: string, channelId: string, messages: Message[]): Promise<void> {
    const config = await this.getConfig(guildId);
    if (!config.messageBulkDelete) return;

    const preview = messages
      .slice(0, 25)
      .map((message) => message.content ? "<@" + message.author.id + ">: " + message.content : "#" + message.id)
      .join("\n");

    await this.emit(
      guildId,
      "logging.message.bulk-delete",
      "🧹 Массовое удаление сообщений",
      "Канал: <#" + channelId + ">\nУдалено: " + messages.length + (preview ? "\n\n" + preview : ""),
      { channelId, count: messages.length, messageIds: messages.slice(0, 100).map((message) => message.id) }
    );
  }

  private async onReaction(
    reaction: import("discord.js").MessageReaction,
    user: import("discord.js").User,
    action: "add" | "remove"
  ): Promise<void> {
    const guildId = reaction.message.guildId;
    if (!guildId) return;

    const config = await this.getConfig(guildId);
    if (!config.reactions) return;

    const emoji = reaction.emoji.name ?? reaction.emoji.id ?? "emoji";
    const label = action === "add" ? "добавил" : "снял";
    await this.emit(
      guildId,
      "logging.reaction." + action,
      action === "add" ? "👍 Реакция добавлена" : "👎 Реакция снята",
      "Пользователь: <@" + user.id + ">\nСообщение: <https://discord.com/channels/" + guildId + "/" + reaction.message.channelId + "/" + reaction.message.id + ">\nEmoji: " + emoji + "\nПользователь " + label + " реакцию.",
      { userId: user.id, messageId: reaction.message.id, channelId: reaction.message.channelId, emoji: reaction.emoji.id ?? reaction.emoji.name ?? "unknown", count: reaction.count ?? 0 }
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

    const before = new Set(oldMember.roles.cache.keys());
    const after = new Set(newMember.roles.cache.keys());
    const addedRoles = [...after].filter((id) => id !== newMember.guild.id && !before.has(id));
    const removedRoles = [...before].filter((id) => id !== newMember.guild.id && !after.has(id));
    if (addedRoles.length) changes.push("Добавлены роли: " + addedRoles.map((id) => "<@&" + id + ">").join(", "));
    if (removedRoles.length) changes.push("Сняты роли: " + removedRoles.map((id) => "<@&" + id + ">").join(", "));

    if (!changes.length) return;

    await this.emit(
      newMember.guild.id,
      "logging.member.update",
      "👤 Участник изменён",
      "Пользователь: <@" + newMember.id + ">\\n" + changes.join("\\n"),
      { userId: newMember.id, addedRoles, removedRoles }
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

  private async onChannelCreate(
    channel: import("discord.js").NonThreadGuildBasedChannel | import("discord.js").ThreadChannel
  ): Promise<void> {
    if (!channel.guildId) return;
    const config = await this.getConfig(channel.guildId);
    if (!config.channelDelete) return;
    await this.emit(
      channel.guildId,
      "logging.channel.create",
      "📁 Канал создан",
      "Канал: " + (channel.name ?? channel.id) + "\nID: " + channel.id,
      { channelId: channel.id }
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

  private async onChannelUpdate(
    oldChannel: import("discord.js").NonThreadGuildBasedChannel | import("discord.js").ThreadChannel,
    newChannel: import("discord.js").NonThreadGuildBasedChannel | import("discord.js").ThreadChannel
  ): Promise<void> {
    if (!newChannel.guildId) return;
    const config = await this.getConfig(newChannel.guildId);
    if (!config.channelUpdate) return;

    const before = oldChannel as typeof oldChannel & { name?: string | null; parentId?: string | null };
    const after = newChannel as typeof newChannel & { name?: string | null; parentId?: string | null };
    const changes: string[] = [];
    if (before.name !== after.name) changes.push("Название: " + (before.name ?? "—") + " → " + (after.name ?? "—"));
    if (before.parentId !== after.parentId) changes.push("Категория: " + (before.parentId ? "<#" + before.parentId + ">" : "—") + " → " + (after.parentId ? "<#" + after.parentId + ">" : "—"));
    if (!changes.length) return;

    await this.emit(
      newChannel.guildId,
      "logging.channel.update",
      "✏️ Канал изменён",
      "Канал: <#" + newChannel.id + ">\n" + changes.join("\n"),
      { channelId: newChannel.id, changes }
    );
  }

  private async onRoleCreate(
    role: import("discord.js").Role
  ): Promise<void> {
    const config = await this.getConfig(role.guild.id);
    if (!config.roleDelete) return;
    await this.emit(
      role.guild.id,
      "logging.role.create",
      "🎭 Роль создана",
      "Роль: " + role.name + "\nID: " + role.id,
      { roleId: role.id, roleName: role.name }
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

  private async onRoleUpdate(oldRole: import("discord.js").Role, newRole: import("discord.js").Role): Promise<void> {
    const config = await this.getConfig(newRole.guild.id);
    if (!config.roleUpdate) return;

    const changes: string[] = [];
    if (oldRole.name !== newRole.name) changes.push("Название: " + oldRole.name + " → " + newRole.name);
    if (oldRole.position !== newRole.position) changes.push("Позиция: " + oldRole.position + " → " + newRole.position);
    if (String(oldRole.permissions.bitfield) !== String(newRole.permissions.bitfield)) changes.push("Permissions изменены");
    if (oldRole.hoist !== newRole.hoist) changes.push("Hoist: " + oldRole.hoist + " → " + newRole.hoist);
    if (oldRole.mentionable !== newRole.mentionable) changes.push("Mentionable: " + oldRole.mentionable + " → " + newRole.mentionable);
    if (!changes.length) return;

    await this.emit(
      newRole.guild.id,
      "logging.role.update",
      "✏️ Роль изменена",
      "Роль: <@&" + newRole.id + ">\n" + changes.join("\n"),
      { roleId: newRole.id, changes }
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
