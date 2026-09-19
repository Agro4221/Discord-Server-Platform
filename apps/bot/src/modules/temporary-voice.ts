import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type VoiceState
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { logger } from "../logger.js";
import { PermissionChecker } from "../discord/permissions.js";

type TempVoiceConfig = {
  enabled: boolean;
  triggerChannelId: string;
  categoryId: string | null;
  defaultLimit: number;
  privateByDefault: boolean;
};

export class TemporaryVoice implements PlatformModule {
  readonly name = "temporary-voice";
  private readonly rooms = new Map<string, { guildId: string; ownerId: string }>();
  private clientReady = false;

  constructor(private readonly db: Database, private readonly getGuilds: () => Iterable<Guild>) {}

  async init(_context: ModuleContext): Promise<void> {
    const result = await this.db.query<{
      guild_id: string;
      channel_id: string;
      owner_id: string;
    }>("SELECT guild_id, channel_id, owner_id FROM temp_voice_rooms");

    for (const row of result.rows) {
      this.rooms.set(row.channel_id, { guildId: row.guild_id, ownerId: row.owner_id });
    }

    logger.info("Temporary voice state loaded", { rooms: this.rooms.size });
  }

  markReady(): void {
    this.clientReady = true;
    void this.reconcile();
  }

  async shutdown(): Promise<void> {
    this.rooms.clear();
    this.clientReady = false;
  }

  async configure(guildId: string, config: TempVoiceConfig): Promise<void> {
    await this.db.query(
      `INSERT INTO guild_settings
        (guild_id, temp_voice_enabled, temp_voice_trigger_channel_id, temp_voice_category_id, temp_voice_default_limit, temp_voice_private, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (guild_id) DO UPDATE SET
        temp_voice_enabled=EXCLUDED.temp_voice_enabled,
        temp_voice_trigger_channel_id=EXCLUDED.temp_voice_trigger_channel_id,
        temp_voice_category_id=EXCLUDED.temp_voice_category_id,
        temp_voice_default_limit=EXCLUDED.temp_voice_default_limit,
        temp_voice_private=EXCLUDED.temp_voice_private,
        updated_at=now()`,
      [guildId, config.enabled, config.triggerChannelId, config.categoryId, config.defaultLimit, config.privateByDefault]
    );    await this.db.query(
      "INSERT INTO guild_modules(guild_id,module_key,enabled) VALUES($1,$2,$3) ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now()",
      [guildId, "temporary-voice", config.enabled]
    );
  }

  async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!this.clientReady || !newState.guild) return;

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await this.handleLeave(oldState);
    }

    if (
      newState.channelId &&
      oldState.channelId !== newState.channelId
    ) {
      const config = await this.getConfig(newState.guild.id);
      if (config?.enabled && config.triggerChannelId === newState.channelId) {
        await this.createRoom(newState, config);
      }
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
      "SELECT gs.temp_voice_enabled,gs.temp_voice_trigger_channel_id,gs.temp_voice_category_id,gs.temp_voice_default_limit,gs.temp_voice_private,COALESCE(gm.enabled,gs.temp_voice_enabled) AS module_enabled FROM guild_settings gs LEFT JOIN guild_modules gm ON gm.guild_id=gs.guild_id AND gm.module_key=$2 WHERE gs.guild_id=$1",
      [guildId, "temporary-voice"]
    );

    const row = result.rows[0];
    if (!row || !row.temp_voice_trigger_channel_id) return null;

    return {
      enabled: row.temp_voice_enabled && row.module_enabled,
      triggerChannelId: row.temp_voice_trigger_channel_id,
      categoryId: row.temp_voice_category_id,
      defaultLimit: row.temp_voice_default_limit,
      privateByDefault: row.temp_voice_private
    };
  }

  private async createRoom(state: VoiceState, config: TempVoiceConfig): Promise<void> {
    const guild = state.guild;
    const member = state.member;
    if (!member) return;

    const checker = new PermissionChecker(guild);
    for (const permission of PermissionChecker.requiredForTemporaryVoice()) {
      if (!checker.botCan(permission)) {
        logger.warn("Temporary voice unavailable: missing bot permission", {
          guildId: guild.id,
          permission: permission.toString()
        });
        return;
      }
    }

    const trigger = guild.channels.cache.get(config.triggerChannelId);
    const parent = config.categoryId ? guild.channels.cache.get(config.categoryId) : undefined;

    const channel = await guild.channels.create({
      name: `DSP • ${member.displayName}`,
      type: ChannelType.GuildVoice,
      parent: parent?.type === ChannelType.GuildCategory ? parent.id : trigger?.parentId ?? undefined,
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

    this.rooms.set(channel.id, { guildId: guild.id, ownerId: member.id });
    await this.db.query(
      "INSERT INTO temp_voice_rooms(guild_id,channel_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(channel_id) DO UPDATE SET owner_id=EXCLUDED.owner_id",
      [guild.id, channel.id, member.id]
    );

    try {
      await member.voice.setChannel(channel);
    } catch (error) {
      logger.warn("Failed to move owner into temporary voice channel", {
        guildId: guild.id,
        channelId: channel.id,
        error: String(error)
      });
    }
  }

  private async handleLeave(state: VoiceState): Promise<void> {
    const channelId = state.channelId;
    if (!channelId || !this.rooms.has(channelId)) return;

    const channel = state.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await this.removeRoomRecord(channelId);
      return;
    }

    if (channel.members.size === 0) {
      try {
        await channel.delete("Temporary voice room became empty");
      } catch (error) {
        logger.warn("Failed to delete empty temporary voice channel", {
          guildId: state.guild.id,
          channelId,
          error: String(error)
        });
      }
      await this.removeRoomRecord(channelId);
      return;
    }

    const room = this.rooms.get(channelId);
    if (!room) return;

    if (room.ownerId === state.id) {
      const nextOwner = channel.members.first();
      if (nextOwner) {
        await this.transferOwnership(state.guild, channel.id, nextOwner.id);
      }
    }
  }

  private async transferOwnership(guild: Guild, channelId: string, ownerId: string): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) return;

    room.ownerId = ownerId;
    await this.db.query("UPDATE temp_voice_rooms SET owner_id=$1 WHERE channel_id=$2", [ownerId, channelId]);

    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;

    try {
      await channel.permissionOverwrites.edit(ownerId, {
        ViewChannel: true,
        Connect: true,
        Speak: true
      });
    } catch (error) {
      logger.warn("Failed to update temporary voice owner permissions", {
        guildId: guild.id,
        channelId,
        ownerId,
        error: String(error)
      });
    }
  }

  private async removeRoomRecord(channelId: string): Promise<void> {
    this.rooms.delete(channelId);
    await this.db.query("DELETE FROM temp_voice_rooms WHERE channel_id=$1", [channelId]);
  }

  async reconcile(): Promise<void> {
    if (!this.clientReady) return;

    const staleIds: string[] = [];
    for (const [channelId, room] of this.rooms) {
      const guild = [...this.getGuilds()].find((candidate) => candidate.id === room.guildId);
      if (!guild) {
        staleIds.push(channelId);
        continue;
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        staleIds.push(channelId);
        continue;
      }

      if (channel.members.size === 0) {
        try {
          await channel.delete("Temporary voice reconciliation cleanup");
        } catch (error) {
          logger.warn("Failed reconciliation cleanup", {
            guildId: guild.id,
            channelId,
            error: String(error)
          });
        }
        staleIds.push(channelId);
      }
    }

    for (const channelId of staleIds) {
      await this.removeRoomRecord(channelId);
    }

    logger.info("Temporary voice reconciliation complete", {
      rooms: this.rooms.size,
      staleRemoved: staleIds.length
    });
  }
}
