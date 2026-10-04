import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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

  constructor(
    private readonly db: Database,
    private readonly identityId: string,
    private readonly credentialSecret: string
  ) {}

  async ensureIdentity(id: string, clientId: string, token?: string): Promise<void> {
    await this.db.query(
      `INSERT INTO bot_identities(id,client_id,enabled,presence_name,token_ciphertext)
       VALUES($1,$2,true,$3,$4)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,
         token_ciphertext=COALESCE(EXCLUDED.token_ciphertext,bot_identities.token_ciphertext),
         updated_at=now()`,
      [id, clientId, id, token ? this.encryptToken(token) : null]
    );
  }

  async credentials(): Promise<{
    id: string;
    clientId: string;
    token: string | null;
    enabled: boolean;
    presenceName: string | null;
  } | null> {
    const result = await this.db.query<{
      id: string;
      client_id: string;
      token_ciphertext: string | null;
      enabled: boolean;
      presence_name: string | null;
    }>(
      "SELECT id,client_id,token_ciphertext,enabled,presence_name FROM bot_identities WHERE id=$1",
      [this.identityId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      clientId: row.client_id,
      token: row.token_ciphertext ? this.decryptToken(row.token_ciphertext) : null,
      enabled: row.enabled,
      presenceName: row.presence_name
    };
  }

  async settings(): Promise<BotIdentityRecord & { tokenConfigured: boolean }> {
    const result = await this.db.query<BotIdentityRecord & { tokenConfigured: boolean }>(
      `SELECT id,client_id AS "clientId",enabled,presence_name AS "presenceName",
              token_ciphertext IS NOT NULL AS "tokenConfigured"
         FROM bot_identities WHERE id=$1`,
      [this.identityId]
    );
    const row = result.rows[0];
    if (row) return row;
    return {
      id: this.identityId,
      clientId: "",
      enabled: false,
      presenceName: null,
      tokenConfigured: false
    };
  }

  async saveSettings(input: {
    clientId: string;
    token?: string;
    enabled?: boolean;
    presenceName?: string | null;
  }): Promise<BotIdentityRecord & { tokenConfigured: boolean }> {
    const current = await this.settings();
    const enabled = input.enabled ?? current.enabled ?? true;
    const presenceName = input.presenceName === undefined ? current.presenceName : input.presenceName;
    const tokenCiphertext = input.token
      ? this.encryptToken(input.token)
      : null;

    await this.db.query(
      `INSERT INTO bot_identities(id,client_id,enabled,presence_name,token_ciphertext)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id,
         enabled=EXCLUDED.enabled,
         presence_name=EXCLUDED.presence_name,
         token_ciphertext=COALESCE(EXCLUDED.token_ciphertext,bot_identities.token_ciphertext),
         updated_at=now()`,
      [this.identityId, input.clientId, enabled, presenceName, tokenCiphertext]
    );
    return this.settings();
  }

  private encryptionKey(): Buffer {
    return createHash("sha256").update(this.credentialSecret, "utf8").digest();
  }

  private encryptToken(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  private decryptToken(value: string): string {
    const [version, ivText, tagText, ciphertextText] = value.split(".");
    if (version !== "v1" || !ivText || !tagText || !ciphertextText) {
      throw new Error("invalid_bot_credential_ciphertext");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final()
    ]).toString("utf8");
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
              COALESCE(bh.guild_count, 0) AS guild_count
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
      if (isUniqueConstraint(error, "guild_music_bot_assignments_guild_id_voice_channel_id_key")) {
        throw new Error("music_voice_channel_already_assigned");
      }
      throw error;
    }
  }

  async musicVoiceOwner(guildId: string, voiceChannelId: string): Promise<string | null> {
    const result = await this.db.query<{ bot_identity_id: string }>(
      "SELECT a.bot_identity_id FROM guild_music_bot_assignments a LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=a.bot_identity_id WHERE a.guild_id=$1 AND a.voice_channel_id=$2 AND (a.bot_identity_id='primary' OR (bh.last_seen_at IS NOT NULL AND bh.last_seen_at >= now()-interval '90 seconds'))",
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
          "SELECT ga.guild_id FROM guild_bot_assignments ga LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id WHERE ga.bot_identity_id='primary' OR (ga.bot_identity_id <> 'primary' AND (bh.last_seen_at IS NULL OR bh.last_seen_at < now()-interval '90 seconds'))",
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

export function identityLabel(client: Client): string {
  return client.user?.tag ?? "unknown-bot";
}


function isUniqueConstraint(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; constraint?: unknown };
  return value.code === "23505" && value.constraint === constraint;
}
