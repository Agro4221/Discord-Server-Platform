import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type VoiceState
} from "discord.js";
import { Store, type TempVoiceSettings } from "./db.js";

export class TemporaryVoiceService {
  constructor(private readonly store: Store) {}

  async reconcile(guilds: Iterable<Guild>): Promise<void> {
    const guildList = [...guilds];

    for (const room of this.store.listTempRooms()) {
      const guild = guildList.find((item) => item.id === room.guildId);

      if (!guild) {
        this.store.removeTempRoom(room.channelId);
        continue;
      }

      const channel = await guild.channels.fetch(room.channelId).catch(() => null);

      if (!channel) {
        this.store.removeTempRoom(room.channelId);
        continue;
      }

      if (channel.type === ChannelType.GuildVoice && channel.members.size === 0) {
        await channel.delete("Temporary room cleanup after restart").catch(() => undefined);
        this.store.removeTempRoom(room.channelId);
      }
    }
  }

  async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const enteredTrigger =
      newState.channelId !== oldState.channelId &&
      newState.channelId !== null;

    if (enteredTrigger && newState.member) {
      const settings = this.store.getTempVoice(newState.guild.id);

      if (settings && newState.channelId === settings.triggerChannelId) {
        await this.createRoom(
          newState.guild,
          newState.member.id,
          newState.member.displayName,
          settings
        );
      }
    }

    const oldChannelId = oldState.channelId;
    const leftTempRoom =
      oldChannelId !== null &&
      oldChannelId !== newState.channelId &&
      this.store.isTempRoom(oldChannelId);

    if (leftTempRoom) {
      const channel = await oldState.guild.channels.fetch(oldChannelId).catch(() => null);

      if (!channel || (channel.isVoiceBased() && channel.members.size === 0)) {
        await channel?.delete("Temporary room became empty").catch(() => undefined);
        this.store.removeTempRoom(oldChannelId);
      }
    }
  }

  private async createRoom(
    guild: Guild,
    ownerId: string,
    displayName: string,
    settings: TempVoiceSettings
  ): Promise<void> {
    const member = await guild.members.fetch(ownerId);
    const botMember = guild.members.me;

    const permissionOverwrites = settings.privateByDefault ? [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
      },
      {
        id: ownerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak
        ]
      },
      ...(botMember ? [{
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers
        ]
      }] : [])
    ] : undefined;

    const bitrate = Math.min(96_000, guild.maximumBitrate);

    const channel = await guild.channels.create({
      name: "🔊 " + displayName.slice(0, 80),
      type: ChannelType.GuildVoice,
      parent: settings.categoryId ?? undefined,
      userLimit: settings.userLimit,
      bitrate,
      permissionOverwrites
    });

    this.store.addTempRoom(guild.id, channel.id, ownerId);
    await member.voice.setChannel(channel);
  }
}
