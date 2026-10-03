import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type VoiceState
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { logger } from "../logger.js";

export type TempVoiceConfig = {
  enabled: boolean;
  triggerChannelId: string;
  categoryId: string | null;
  defaultLimit: number;
  privateByDefault: boolean;
};

type Room = { guildId: string; ownerId: string };

export class TemporaryVoice implements PlatformModule {
  readonly name = "temporary-voice";
  private readonly rooms = new Map<string, Room>();
  private readonly creationInFlight = new Set<string>();
  private ready = false;
  private unsubscribeFromVoice?: () => void;

  constructor(private readonly db: Database, private readonly getGuilds: () => Iterable<Guild>) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribeFromVoice = context.events.on("voice.state", ({ oldState, newState }) => {
      return this.handleVoiceState(oldState, newState);
    });
    const result = await this.db.query<{
      guild_id: string;
      channel_id: string;
      owner_id: string;
    }>("SELECT guild_id,channel_id,owner_id FROM temp_voice_rooms");

    for (const row of result.rows) {
      this.rooms.set(row.channel_id, { guildId: row.guild_id, ownerId: row.owner_id });
    }

    logger.info("Temporary voice state loaded", { rooms: this.rooms.size });
  }

  async shutdown(): Promise<void> {
    this.ready = false;
    this.creationInFlight.clear();
    this.unsubscribeFromVoice?.();
    this.unsubscribeFromVoice = undefined;
  }

  markReady(): void {
    this.ready = true;
    void this.reconcile();
  }

  isReady(): boolean {
    return this.ready;
  }


  async executeSlashCommand(interaction: import("discord.js").ChatInputCommandInteraction, commandName = interaction.commandName): Promise<void> {
    if (!interaction.inGuild() || commandName !== "voice") return;
    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: "Не удалось получить данные участника.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand() as VoiceControl;
    try {
      const reply = await this.controlVoiceRoom(interaction.guild!, member, sub, {
        value: sub === "limit" ? interaction.options.getInteger("limit", true) : undefined,
        name: sub === "name" ? interaction.options.getString("name", true) : undefined,
        targetUserId: ["transfer", "permit", "reject"].includes(sub)
          ? interaction.options.getUser("user", true).id
          : undefined
      });
      await interaction.reply({ content: reply, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: formatTemporaryVoiceControlError(error), ephemeral: true });
    }
  }

  async handlePrefixCommand(message: import("discord.js").Message, commandName: string, args: string[]): Promise<boolean> {
    if (commandName !== "voice" || !message.guild) return false;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return true;

    const sub = (args.shift() ?? "info").toLowerCase() as VoiceControl;
    const first = args.shift();
    const options = {
      value: sub === "limit" ? Number(first ?? "") : undefined,
      name: sub === "name" ? [first, ...args].filter(Boolean).join(" ") : undefined,
      targetUserId: ["transfer", "permit", "reject"].includes(sub)
        ? (message.mentions.users.first()?.id ?? first)
        : undefined
    };

    try {
      const reply = await this.controlVoiceRoom(message.guild, member, sub, options);
      await message.reply(reply);
    } catch (error) {
      await message.reply(formatTemporaryVoiceControlError(error));
    }
    return true;
  }

  private async controlVoiceRoom(
    guild: Guild,
    member: GuildMember,
    action: VoiceControl,
    options: { value?: number; name?: string; targetUserId?: string }
  ): Promise<string> {
    const context = this.roomContext(guild, member);

    if (action === "info") {
      return "🎙️ <#" + context.channel.id + "> · владелец <@" + context.room.ownerId + "> · участников " +
        context.channel.members.size + "/" + (context.channel.userLimit || "∞") + ".";
    }

    if (context.room.ownerId !== member.id && !member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      throw new Error("temporary_voice_not_owner");
    }

    switch (action) {
      case "lock":
        await context.channel.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: false });
        return "🔒 Временная голосовая комната закрыта для новых подключений.";
      case "unlock":
        await context.channel.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: null });
        return "🔓 Ограничение подключения к временной комнате снято.";
      case "limit": {
        const value = options.value;
        if (!Number.isInteger(value) || value! < 0 || value! > 99) throw new Error("temporary_voice_invalid_limit");
        await context.channel.setUserLimit(value!);
        return value === 0 ? "👥 Лимит комнаты снят." : "👥 Лимит комнаты: " + value + ".";
      }
      case "name": {
        const value = options.name?.trim() ?? "";
        if (!value || value.length > 100) throw new Error("temporary_voice_invalid_name");
        await context.channel.setName(value);
        return "✏️ Название комнаты изменено.";
      }
      case "transfer": {
        if (!options.targetUserId || !/^\d{15,25}$/.test(options.targetUserId)) throw new Error("temporary_voice_target_required");
        const target = await guild.members.fetch(options.targetUserId).catch(() => null);
        if (!target) throw new Error("temporary_voice_target_not_found");
        if (target.user.bot) throw new Error("temporary_voice_target_bot");
        await this.transferOwner(context.channel, context.room.ownerId, target.id);
        return "👑 Владелец комнаты передан пользователю <@" + target.id + ">.";
      }
      case "permit": {
        const target = await this.fetchControlTarget(guild, options.targetUserId);
        await context.channel.permissionOverwrites.edit(target.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true
        });
        return "✅ <@" + target.id + "> разрешён доступ к комнате.";
      }
      case "reject": {
        const target = await this.fetchControlTarget(guild, options.targetUserId);
        await context.channel.permissionOverwrites.edit(target.id, {
          ViewChannel: false,
          Connect: false
        });
        if (target.voice.channelId === context.channel.id) {
          await target.voice.disconnect().catch(() => undefined);
        }
        return "⛔ Доступ пользователя <@" + target.id + "> к комнате закрыт.";
      }
      default:
        throw new Error("temporary_voice_unknown_action");
    }
  }

  private roomContext(guild: Guild, member: GuildMember): { channel: import("discord.js").VoiceChannel; room: Room } {
    const channel = member.voice.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error("temporary_voice_room_required");
    }
    const room = this.rooms.get(channel.id);
    if (!room || room.guildId !== guild.id) {
      throw new Error("temporary_voice_room_required");
    }
    return { channel, room };
  }

  private async fetchControlTarget(guild: Guild, userId: string | undefined): Promise<GuildMember> {
    if (!userId || !/^\d{15,25}$/.test(userId)) throw new Error("temporary_voice_target_required");
    const target = await guild.members.fetch(userId).catch(() => null);
    if (!target) throw new Error("temporary_voice_target_not_found");
    if (target.user.bot) throw new Error("temporary_voice_target_bot");
    return target;
  }

  async configure(guildId: string, config: TempVoiceConfig): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO guild_settings
          (guild_id,temp_voice_enabled,temp_voice_trigger_channel_id,temp_voice_category_id,temp_voice_default_limit,temp_voice_private,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT(guild_id) DO UPDATE SET
          temp_voice_enabled=EXCLUDED.temp_voice_enabled,
          temp_voice_trigger_channel_id=EXCLUDED.temp_voice_trigger_channel_id,
          temp_voice_category_id=EXCLUDED.temp_voice_category_id,
          temp_voice_default_limit=EXCLUDED.temp_voice_default_limit,
          temp_voice_private=EXCLUDED.temp_voice_private,
          updated_at=now()`,
        [guildId, config.enabled, config.triggerChannelId, config.categoryId, config.defaultLimit, config.privateByDefault]
      );
      await client.query(
        `INSERT INTO guild_modules(guild_id,module_key,enabled)
         VALUES($1,'temporary-voice',$2)
         ON CONFLICT(guild_id,module_key)
         DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
        [guildId, config.enabled]
      );
    });

    if (!config.enabled) await this.cleanupGuild(guildId);
  }

  async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!this.ready || !newState.guild) return;

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await this.handleLeave(oldState);
    }

    if (!newState.channelId || oldState.channelId === newState.channelId) return;

    const config = await this.getConfig(newState.guild.id);
    if (!config?.enabled || config.triggerChannelId !== newState.channelId) return;

    const member = newState.member;
    if (!member || member.user.bot) return;

    const key = `${newState.guild.id}:${member.id}`;
    if (this.creationInFlight.has(key)) return;

    const existing = this.roomsByOwner(newState.guild.id, member.id);
    const existingId = existing[0];
    if (existingId) {
      const existingChannel = newState.guild.channels.cache.get(existingId);
      if (existingChannel?.type === ChannelType.GuildVoice && member.voice.channelId === config.triggerChannelId) {
        await member.voice.setChannel(existingChannel).catch((error) => {
          logger.warn("Temporary voice move to existing room failed", {
            guildId: newState.guild.id,
            userId: member.id,
            channelId: existingId,
            error: String(error)
          });
        });
      }
      return;
    }

    this.creationInFlight.add(key);
    try {
      await this.createRoom(newState, config);
    } finally {
      this.creationInFlight.delete(key);
    }
  }

  private async getConfig(guildId: string): Promise<TempVoiceConfig | null> {
    const result = await this.db.query<{
      temp_voice_enabled: boolean;
      temp_voice_trigger_channel_id: string | null;
      temp_voice_category_id: string | null;
      temp_voice_default_limit: number;
      temp_voice_private: boolean;
      module_enabled: boolean;
    }>(
      `SELECT gs.temp_voice_enabled,gs.temp_voice_trigger_channel_id,gs.temp_voice_category_id,
              gs.temp_voice_default_limit,gs.temp_voice_private,
              COALESCE(gm.enabled,gs.temp_voice_enabled) AS module_enabled
       FROM guild_settings gs
       LEFT JOIN guild_modules gm
         ON gm.guild_id=gs.guild_id AND gm.module_key=$2
       WHERE gs.guild_id=$1`,
      [guildId, "temporary-voice"]
    );

    const row = result.rows[0];
    if (!row?.temp_voice_trigger_channel_id) return null;

    return {
      enabled: row.temp_voice_enabled && row.module_enabled,
      triggerChannelId: row.temp_voice_trigger_channel_id,
      categoryId: row.temp_voice_category_id,
      defaultLimit: Math.min(Math.max(row.temp_voice_default_limit, 0), 99),
      privateByDefault: row.temp_voice_private
    };
  }

  private async createRoom(state: VoiceState, config: TempVoiceConfig): Promise<void> {
    const guild = state.guild;
    const member = state.member;
    if (!member || member.voice.channelId !== config.triggerChannelId) return;

    const trigger = guild.channels.cache.get(config.triggerChannelId);
    const parent = config.categoryId
      ? guild.channels.cache.get(config.categoryId)
      : trigger?.parent;

    if (!trigger || trigger.type !== ChannelType.GuildVoice) {
      logger.warn("Temporary voice trigger channel is missing or invalid", {
        guildId: guild.id,
        triggerChannelId: config.triggerChannelId
      });
      return;
    }

    const me = guild.members.me;
    const targetPermissionChannel =
      parent?.type === ChannelType.GuildCategory ? parent : trigger;

    const required = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.MoveMembers
    ];

    const missing = required.filter(
      (permission) => !targetPermissionChannel.permissionsFor(me ?? guild.roles.everyone)?.has(permission)
    );

    if (missing.length > 0 || !me) {
      logger.warn("Temporary voice unavailable because of channel permissions", {
        guildId: guild.id,
        missing: missing.map(String)
      });
      return;
    }

    const channel = await guild.channels.create({
      name: `DSP • ${member.displayName}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: parent?.type === ChannelType.GuildCategory ? parent.id : undefined,
      userLimit: config.defaultLimit,
      permissionOverwrites: config.privateByDefault
        ? [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
            },
            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak
              ]
            }
          ]
        : undefined
    });

    try {
      await this.db.transaction(async (client) => {
        await client.query(
          "INSERT INTO temp_voice_rooms(guild_id,channel_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(channel_id) DO UPDATE SET owner_id=EXCLUDED.owner_id",
          [guild.id, channel.id, member.id]
        );
      });
      this.rooms.set(channel.id, { guildId: guild.id, ownerId: member.id });

      if (member.voice.channelId === config.triggerChannelId) {
        await member.voice.setChannel(channel);
      }
    } catch (error) {
      logger.error("Temporary voice persistence/move failed; deleting new room", {
        guildId: guild.id,
        channelId: channel.id,
        error: String(error)
      });
      this.rooms.delete(channel.id);
      await channel.delete("Temporary voice setup failed").catch((deleteError) => {
        logger.error("Temporary voice rollback channel delete failed", {
          guildId: guild.id,
          channelId: channel.id,
          error: String(deleteError)
        });
      });
    }
  }

  private async handleLeave(state: VoiceState): Promise<void> {
    const channelId = state.channelId;
    if (!channelId) return;

    const room = this.rooms.get(channelId);
    if (!room) return;

    const channel = state.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await this.removeRoomRecord(channelId);
      return;
    }

    if (channel.members.size === 0) {
      await channel.delete("Temporary voice room became empty").catch((error) =>
        logger.warn("Failed to delete empty temporary voice channel", {
          guildId: state.guild.id,
          channelId,
          error: String(error)
        })
      );
      await this.removeRoomRecord(channelId);
      return;
    }

    if (room.ownerId === state.id) {
      const replacement = channel.members.first();
      if (replacement) await this.transferOwner(channel, state.id, replacement.id);
    }
  }

  private async transferOwner(
    channel: Extract<NonNullable<ReturnType<Guild["channels"]["cache"]["get"]>>, { type: ChannelType.GuildVoice }>,
    oldOwnerId: string,
    newOwnerId: string
  ): Promise<void> {
    const room = this.rooms.get(channel.id);
    if (!room) return;

    await channel.permissionOverwrites.delete(oldOwnerId).catch((error) => {
      logger.warn("Temporary voice old-owner permission cleanup failed", {
        guildId: channel.guild.id,
        channelId: channel.id,
        ownerId: oldOwnerId,
        error: String(error)
      });
    });
    await channel.permissionOverwrites.edit(newOwnerId, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    }).catch((error) =>
      logger.warn("Failed to update temporary voice owner permissions", {
        guildId: channel.guild.id,
        channelId: channel.id,
        ownerId: newOwnerId,
        error: String(error)
      })
    );

    room.ownerId = newOwnerId;
    await this.db.query(
      "UPDATE temp_voice_rooms SET owner_id=$1 WHERE channel_id=$2",
      [newOwnerId, channel.id]
    );
  }

  private roomsByOwner(guildId: string, ownerId: string): string[] {
    return [...this.rooms.entries()]
      .filter(([, room]) => room.guildId === guildId && room.ownerId === ownerId)
      .map(([channelId]) => channelId);
  }

  private async removeRoomRecord(channelId: string): Promise<void> {
    this.rooms.delete(channelId);
    await this.db.query("DELETE FROM temp_voice_rooms WHERE channel_id=$1", [channelId]);
  }

  private async cleanupGuild(guildId: string): Promise<void> {
    const ids = [...this.rooms.entries()]
      .filter(([, room]) => room.guildId === guildId)
      .map(([channelId]) => channelId);

    const guild = [...this.getGuilds()].find((candidate) => candidate.id === guildId);
    for (const channelId of ids) {
      const channel = guild?.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        await this.removeRoomRecord(channelId);
        continue;
      }

      if (shouldDeleteEmptyTemporaryVoiceRoom(channel.members.size)) {
        await channel.delete("Temporary voice module disabled").catch((error) => {
          logger.warn("Temporary voice disabled cleanup failed", {
            guildId,
            channelId,
            error: String(error)
          });
        });
        await this.removeRoomRecord(channelId);
        continue;
      }

      logger.info("Temporary voice cleanup deferred because room is occupied", {
        guildId,
        channelId,
        members: channel.members.size
      });
    }
  }

  async reconcileGuild(guildId: string): Promise<void> {
    if (!this.ready) return;
    const guild = [...this.getGuilds()].find((candidate) => candidate.id === guildId);
    if (!guild) return;

    const staleIds = [...this.rooms.entries()]
      .filter(([channelId, room]) => room.guildId === guildId && (!guild.channels.cache.get(channelId) || guild.channels.cache.get(channelId)?.type !== ChannelType.GuildVoice))
      .map(([channelId]) => channelId);

    for (const channelId of staleIds) await this.removeRoomRecord(channelId);
  }

  async reconcile(): Promise<void> {
    if (!this.ready) return;

    const staleIds: string[] = [];
    const guildMap = new Map([...this.getGuilds()].map((guild) => [guild.id, guild]));

    for (const [channelId, room] of this.rooms) {
      const guild = guildMap.get(room.guildId);
      const channel = guild?.channels.cache.get(channelId);

      if (!guild || !channel || channel.type !== ChannelType.GuildVoice) {
        staleIds.push(channelId);
        continue;
      }

      if (channel.members.size === 0) {
        await channel.delete("Temporary voice reconciliation cleanup").catch((error) =>
          logger.warn("Failed reconciliation cleanup", {
            guildId: guild.id,
            channelId,
            error: String(error)
          })
        );
        staleIds.push(channelId);
      }
    }

    for (const channelId of staleIds) await this.removeRoomRecord(channelId);

    logger.info("Temporary voice reconciliation complete", {
      rooms: this.rooms.size,
      staleRemoved: staleIds.length
    });
  }
}


export function shouldDeleteEmptyTemporaryVoiceRoom(memberCount: number): boolean {
  return memberCount <= 0;
}


type VoiceControl = "lock" | "unlock" | "limit" | "name" | "transfer" | "permit" | "reject" | "info";

function formatTemporaryVoiceControlError(error: unknown): string {
  const code = error instanceof Error ? error.message : "temporary_voice_control_failed";
  const messages: Record<string, string> = {
    temporary_voice_room_required: "Ты должен находиться в своей временной голосовой комнате.",
    temporary_voice_not_owner: "Управлять комнатой может её владелец или участник с Manage Channels.",
    temporary_voice_invalid_limit: "Лимит: целое число от 0 до 99.",
    temporary_voice_invalid_name: "Название комнаты должно быть от 1 до 100 символов.",
    temporary_voice_target_required: "Укажи Discord ID пользователя или упомяни пользователя.",
    temporary_voice_target_not_found: "Пользователь не найден на сервере.",
    temporary_voice_target_bot: "Нельзя передать комнату или выдать доступ Discord-боту.",
    temporary_voice_unknown_action: "Неизвестная операция Voice Controls.",
    temporary_voice_control_failed: "Операция с временной комнатой не удалась."
  };
  return messages[code] ?? code;
}
