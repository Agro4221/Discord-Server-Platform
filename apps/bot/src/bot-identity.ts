import type { Client } from "discord.js";
import type { Database } from "./database.js";

export const FLEET_HEARTBEAT_STALE_SECONDS = 90;

export type BotIdentityRecord = {
  id: string;
  clientId: string;
  enabled: boolean;
  failoverEnabled: boolean;
  presenceName: string | null;
};

export type BotFleetRecord = BotIdentityRecord & {
  connected: boolean;
  status: "starting" | "ready" | "degraded" | "stopped";
  lastSeenAt: string | null;
  guildCount: number;
  credentialConfigured: boolean;
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
      "SELECT id,client_id AS \"clientId\",enabled,failover_enabled AS \"failoverEnabled\",presence_name AS \"presenceName\" FROM bot_identities ORDER BY id"
    );
    return result.rows;
  }

  async listFleet(): Promise<BotFleetRecord[]> {
    const result = await this.db.query<{
      id: string;
      client_id: string;
      enabled: boolean;
      presence_name: string | null;
      failover_enabled: boolean;
      status: BotFleetRecord["status"] | null;
      last_seen_at: string | null;
      guild_count: string;
      credential_configured: boolean;
    }>(
      `SELECT bi.id,bi.client_id,bi.enabled,bi.failover_enabled,bi.presence_name,
              bh.status,bh.last_seen_at,
              COALESCE(bh.guild_count, 0) AS guild_count,
              EXISTS (SELECT 1 FROM bot_credentials bc WHERE bc.bot_identity_id=bi.id) AS credential_configured
         FROM bot_identities bi
         LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=bi.id
        ORDER BY bi.id`
    );
    return result.rows.map((row) => {
      const rawStatus = row.status ?? "stopped";
      const heartbeatFresh = isFleetHeartbeatFresh(row.last_seen_at);
      const status = rawStatus === "ready" && !heartbeatFresh ? "degraded" : rawStatus;
      return {
        id: row.id,
        clientId: row.client_id,
        enabled: row.enabled,
        failoverEnabled: row.failover_enabled,
        presenceName: row.presence_name,
        connected: status === "ready" && heartbeatFresh,
        status,
        lastSeenAt: row.last_seen_at,
        guildCount: Number(row.guild_count),
        credentialConfigured: row.credential_configured
      };
    });
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
      if (isUniqueConstraint(error, "guild_music_bot_assignments_guild_id_voice_channel_id_key")) {
        throw new Error("music_voice_channel_already_assigned");
      }
      throw error;
    }
  }

  async musicVoiceOwner(guildId: string, voiceChannelId: string): Promise<string | null> {
    const result = await this.db.query<{ bot_identity_id: string }>(
      "SELECT a.bot_identity_id FROM guild_music_bot_assignments a LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=a.bot_identity_id WHERE a.guild_id=$1 AND a.voice_channel_id=$2 AND (a.bot_identity_id='primary' OR (bh.last_seen_at IS NOT NULL AND bh.last_seen_at >= now()-interval '${FLEET_HEARTBEAT_STALE_SECONDS} seconds'))",
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

  async unassignMusicVoice(guildId: string, botIdentityId: string): Promise<boolean> {
    const result = await this.db.query(
      "DELETE FROM guild_music_bot_assignments WHERE guild_id=$1 AND bot_identity_id=$2",
      [guildId, botIdentityId]
    );
    return result.rowCount === 1;
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
    const result = this.identityId === "primary"
      ? await this.db.query<{ guild_id: string }>(
          "SELECT ga.guild_id FROM guild_bot_assignments ga LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id WHERE ga.bot_identity_id='primary' OR (ga.bot_identity_id <> 'primary' AND (bh.last_seen_at IS NULL OR bh.last_seen_at < now()-interval '${FLEET_HEARTBEAT_STALE_SECONDS} seconds'))",
          []
        )
      : await this.db.query<{ guild_id: string }>(
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

async setFailover(id: string, enabled: boolean): Promise<void> {
    const result = await this.db.query(
      "UPDATE bot_identities SET failover_enabled=$2,updated_at=now() WHERE id=$1 AND enabled=true",
      [id, enabled]
    );
    if (result.rowCount !== 1) throw new Error("bot_identity_not_available");
  }

  async claimStaleGuilds(guildIds: string[], limit = 20): Promise<string[]> {
    if (this.identityId === "primary" || guildIds.length === 0) return [];
    const identity = await this.db.query<{ failover_enabled: boolean; enabled: boolean }>(
      "SELECT failover_enabled,enabled FROM bot_identities WHERE id=$1",
      [this.identityId]
    );
    if (!identity.rows[0]?.enabled || !identity.rows[0].failover_enabled) return [];

    const safeLimit = clampFailoverBatchLimit(limit);
    return this.db.transaction(async (client) => {
      const result = await client.query<{ guild_id: string }>(
        `WITH candidates AS (
           SELECT ga.guild_id
             FROM guild_bot_assignments ga
             LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id
            WHERE ga.guild_id = ANY($1::text[])
              AND ga.bot_identity_id <> $2
              AND (bh.last_seen_at IS NULL OR bh.last_seen_at < now()-interval '${FLEET_HEARTBEAT_STALE_SECONDS} seconds')
            ORDER BY ga.updated_at ASC
            LIMIT $3
            FOR UPDATE OF ga SKIP LOCKED
         )
         UPDATE guild_bot_assignments ga
            SET bot_identity_id=$2,updated_at=now()
           FROM candidates
          WHERE ga.guild_id=candidates.guild_id
          RETURNING ga.guild_id`,
        [guildIds, this.identityId, safeLimit]
      );
      return result.rows.map((row) => row.guild_id);
    });
  }

}

export function resolveIdentityEnv(identityId: string): { token: string; clientId: string } {
  const prefix = identityId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const tokenEnv = "DISCORD_TOKEN_" + prefix;
  const clientIdEnv = "DISCORD_CLIENT_ID_" + prefix;
  const token = process.env[tokenEnv] ?? (identityId === "primary" ? process.env.DISCORD_TOKEN : undefined);
  const clientId = process.env[clientIdEnv] ?? (identityId === "primary" ? process.env.DISCORD_CLIENT_ID : undefined);
  if (!token || !clientId) {
    throw new Error("Missing Discord credentials for identity " + identityId);
  }
  return { token, clientId };
}

export function isFleetHeartbeatFresh(lastSeenAt: string | Date | null, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const timestamp = lastSeenAt instanceof Date ? lastSeenAt.getTime() : Date.parse(lastSeenAt);
  return Number.isFinite(timestamp) && now - timestamp < FLEET_HEARTBEAT_STALE_SECONDS * 1000;
}

export function clampFailoverBatchLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

export function identityLabel(client: Client): string {
  return client.user?.tag ?? "unknown-bot";
}


function isUniqueConstraint(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; constraint?: unknown };
  return value.code === "23505" && value.constraint === constraint;
}
