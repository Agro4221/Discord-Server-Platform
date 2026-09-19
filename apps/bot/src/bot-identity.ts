import type { Client } from "discord.js";
import type { Database } from "./database.js";

export type BotIdentityRecord = {
  id: string;
  clientId: string;
  enabled: boolean;
  presenceName: string | null;
};

export type BotFleetRecord = BotIdentityRecord & {
  connected: boolean;
  status: "starting" | "ready" | "degraded" | "stopped";
  lastSeenAt: string | null;
  guildCount: number;
};

export class BotIdentityRepository {
  private readonly assignedGuilds = new Set<string>();

  constructor(private readonly db: Database, private readonly identityId: string) {}

  async ensureIdentity(id: string, clientId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO bot_identities(id,client_id,enabled,presence_name)
       VALUES($1,$2,true,$3)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,updated_at=now()`,
      [id, clientId, id]
    );
  }

  async list(): Promise<BotIdentityRecord[]> {
    const result = await this.db.query<BotIdentityRecord>(
      "SELECT id,client_id AS \"clientId\",enabled,presence_name AS \"presenceName\" FROM bot_identities ORDER BY id"
    );
    return result.rows;
  }

  async listFleet(): Promise<BotFleetRecord[]> {
    const result = await this.db.query<{
      id: string;
      client_id: string;
      enabled: boolean;
      presence_name: string | null;
      status: BotFleetRecord["status"] | null;
      last_seen_at: string | null;
      guild_count: string;
    }>(
      `SELECT bi.id,bi.client_id,bi.enabled,bi.presence_name,
              bh.status,bh.last_seen_at,
              (SELECT count(*) FROM guild_bot_assignments ga WHERE ga.bot_identity_id=bi.id) AS guild_count
         FROM bot_identities bi
         LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=bi.id
        ORDER BY bi.id`
    );
    return result.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      enabled: row.enabled,
      presenceName: row.presence_name,
      connected: row.status === "ready",
      status: row.status ?? "stopped",
      lastSeenAt: row.last_seen_at,
      guildCount: Number(row.guild_count)
    }));
  }

  async assignGuild(guildId: string, botIdentityId: string): Promise<void> {
    const identity = await this.db.query<{ id: string }>(
      "SELECT id FROM bot_identities WHERE id=$1 AND enabled=true",
      [botIdentityId]
    );
    if (!identity.rows[0]) throw new Error("bot_identity_not_available");

    await this.db.query(
      `INSERT INTO guild_bot_assignments(guild_id,bot_identity_id)
       VALUES($1,$2)
       ON CONFLICT(guild_id) DO UPDATE SET bot_identity_id=EXCLUDED.bot_identity_id,updated_at=now()`,
      [guildId, botIdentityId]
    );
    await this.refreshAssignments();
  }

  async assignment(guildId: string): Promise<string | null> {
    const result = await this.db.query<{ bot_identity_id: string }>(
      "SELECT bot_identity_id FROM guild_bot_assignments WHERE guild_id=$1",
      [guildId]
    );
    return result.rows[0]?.bot_identity_id ?? null;
  }

  async assignMusicVoice(guildId: string, botIdentityId: string, voiceChannelId: string): Promise<void> {
    const identity = await this.db.query<{ id: string }>(
      "SELECT id FROM bot_identities WHERE id=$1 AND enabled=true",
      [botIdentityId]
    );
    if (!identity.rows[0]) throw new Error("bot_identity_not_available");

    try {
      await this.db.query(
        "INSERT INTO guild_music_bot_assignments(guild_id,bot_identity_id,voice_channel_id) VALUES($1,$2,$3) ON CONFLICT(guild_id,bot_identity_id) DO UPDATE SET voice_channel_id=EXCLUDED.voice_channel_id,updated_at=now()",
        [guildId, botIdentityId, voiceChannelId]
      );
    } catch (error) {
      if (String(error).includes("guild_music_bot_assignments_guild_id_voice_channel_id_key")) {
        throw new Error("music_voice_channel_already_assigned");
      }
      throw error;
    }
  }

  async musicVoiceOwner(guildId: string, voiceChannelId: string): Promise<string | null> {
    const result = await this.db.query<{ bot_identity_id: string }>(
      "SELECT bot_identity_id FROM guild_music_bot_assignments WHERE guild_id=$1 AND voice_channel_id=$2",
      [guildId, voiceChannelId]
    );
    return result.rows[0]?.bot_identity_id ?? null;
  }

  async listMusicAssignments(guildId: string): Promise<Array<{
    botIdentityId: string;
    voiceChannelId: string;
  }>> {
    const result = await this.db.query<{ bot_identity_id: string; voice_channel_id: string }>(
      "SELECT bot_identity_id,voice_channel_id FROM guild_music_bot_assignments WHERE guild_id=$1 ORDER BY voice_channel_id",
      [guildId]
    );
    return result.rows.map((row) => ({
      botIdentityId: row.bot_identity_id,
      voiceChannelId: row.voice_channel_id
    }));
  }

  async claimUnassignedGuilds(guildIds: string[]): Promise<void> {
    if (this.identityId !== "primary" || guildIds.length === 0) return;
    for (const guildId of guildIds) {
      await this.db.query(
        `INSERT INTO guild_bot_assignments(guild_id,bot_identity_id)
         VALUES($1,$2)
         ON CONFLICT(guild_id) DO NOTHING`,
        [guildId, this.identityId]
      );
    }
    await this.refreshAssignments();
  }

  async refreshAssignments(): Promise<void> {
    const result = await this.db.query<{ guild_id: string }>(
      "SELECT guild_id FROM guild_bot_assignments WHERE bot_identity_id=$1",
      [this.identityId]
    );
    this.assignedGuilds.clear();
    for (const row of result.rows) this.assignedGuilds.add(row.guild_id);
  }

  ownsGuild(guildId: string): boolean {
    return this.assignedGuilds.has(guildId);
  }

  async heartbeat(status: BotFleetRecord["status"], guildCount: number): Promise<void> {
    await this.db.query(
      `INSERT INTO bot_heartbeats(bot_identity_id,status,last_seen_at,guild_count)
       VALUES($1,$2,now(),$3)
       ON CONFLICT(bot_identity_id)
       DO UPDATE SET status=EXCLUDED.status,last_seen_at=EXCLUDED.last_seen_at,guild_count=EXCLUDED.guild_count`,
      [this.identityId, status, guildCount]
    );
  }
}

export function resolveIdentityEnv(identityId: string): { token: string; clientId: string } {
  const prefix = identityId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const tokenEnv = "DISCORD_TOKEN_" + prefix;
  const clientIdEnv = "DISCORD_CLIENT_ID_" + prefix;
  const token = process.env[tokenEnv] ?? process.env.DISCORD_TOKEN;
  const clientId = process.env[clientIdEnv] ?? process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) throw new Error("Missing Discord credentials for identity " + identityId);
  return { token, clientId };
}

export function identityLabel(client: Client): string {
  return client.user?.tag ?? "unknown-bot";
}
