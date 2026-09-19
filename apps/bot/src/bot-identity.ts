import type { Client } from "discord.js";
import type { Database } from "./database.js";

export type BotIdentityRecord = {
  id: string;
  clientId: string;
  enabled: boolean;
  presenceName: string | null;
};

export class BotIdentityRepository {
  constructor(private readonly db: Database) {}

  async ensureIdentity(id: string, clientId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO bot_identities(id,client_id,enabled,presence_name)
       VALUES($1,$2,true,$3)
       ON CONFLICT(id) DO UPDATE SET client_id=EXCLUDED.client_id`,
      [id, clientId, id]
    );
  }

  async list(): Promise<BotIdentityRecord[]> {
    const result = await this.db.query<BotIdentityRecord>(
      "SELECT id,client_id AS \"clientId\",enabled,presence_name AS \"presenceName\" FROM bot_identities ORDER BY id"
    );
    return result.rows;
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
  }

  async assignment(guildId: string): Promise<string | null> {
    const result = await this.db.query<{ bot_identity_id: string }>(
      "SELECT bot_identity_id FROM guild_bot_assignments WHERE guild_id=$1",
      [guildId]
    );
    return result.rows[0]?.bot_identity_id ?? null;
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
