import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Database } from "./database.js";

export type BotCredentialMetadata = {
  identityId: string;
  clientId: string;
  username: string | null;
  globalName: string | null;
  credentialConfigured: boolean;
  updatedAt: string | null;
};

export type BotRegistrationInput = {
  identityId: string;
  clientId?: string;
  token: string;
  presenceName?: string | null;
  enabled?: boolean;
  failoverEnabled?: boolean;
};

export type BotRegistrationResult = BotCredentialMetadata & {
  created: boolean;
};

type DiscordBotUser = {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  bot?: unknown;
};

type StoredCredential = {
  token_ciphertext: string;
  token_iv: string;
  token_auth_tag: string;
};

const DISCORD_API = "https://discord.com/api/v10/users/@me";

export class BotCredentialsService {
  private readonly key: Buffer;

  constructor(private readonly db: Database, encryptionKey: string) {
    const normalized = encryptionKey.trim();
    if (!/^[a-f0-9]{64}$/i.test(normalized)) {
      throw new Error("BOT_CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
    }
    this.key = Buffer.from(normalized, "hex");
  }

  async bootstrapFromEnvironment(identityId: string, token: string): Promise<void> {
    const encrypted = this.encrypt(token);
    await this.db.query(
      `INSERT INTO bot_credentials(
         bot_identity_id,token_ciphertext,token_iv,token_auth_tag,token_fingerprint
       ) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(bot_identity_id)
       DO UPDATE SET token_ciphertext=EXCLUDED.token_ciphertext,
                     token_iv=EXCLUDED.token_iv,
                     token_auth_tag=EXCLUDED.token_auth_tag,
                     token_fingerprint=EXCLUDED.token_fingerprint,
                     updated_at=now()`,
      [identityId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.fingerprint]
    );
  }

  async getToken(identityId: string): Promise<string | null> {
    const result = await this.db.query<StoredCredential>(
      "SELECT token_ciphertext,token_iv,token_auth_tag FROM bot_credentials WHERE bot_identity_id=$1",
      [identityId]
    );
    const row = result.rows[0];
    return row ? this.decrypt(row) : null;
  }

  async register(input: BotRegistrationInput): Promise<BotRegistrationResult> {
    const identityId = normalizeIdentityId(input.identityId);
    const token = normalizeToken(input.token);
    const user = await validateDiscordBotToken(token);
    const discordClientId = user.id;

    if (input.clientId !== undefined && input.clientId !== discordClientId) {
      throw new Error("discord_client_id_mismatch");
    }

    const existing = await this.db.query<{ id: string; enabled: boolean; failover_enabled: boolean }>(
      "SELECT id,enabled,failover_enabled FROM bot_identities WHERE id=$1",
      [identityId]
    );
    const created = !existing.rows[0];
    const encrypted = this.encrypt(token);

    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO bot_identities(id,client_id,enabled,presence_name)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(id) DO UPDATE SET
           client_id=EXCLUDED.client_id,
           presence_name=COALESCE(EXCLUDED.presence_name,bot_identities.presence_name),
           updated_at=now()`,
        [
          identityId,
          discordClientId,
          input.enabled ?? existing.rows[0]?.enabled ?? true,
          input.presenceName?.trim() || null
        ]
      );

      if (input.failoverEnabled !== undefined) {
        await client.query(
          "UPDATE bot_identities SET failover_enabled=$2,updated_at=now() WHERE id=$1",
          [identityId, input.failoverEnabled]
        );
      }

      await client.query(
        `INSERT INTO bot_credentials(
           bot_identity_id,token_ciphertext,token_iv,token_auth_tag,token_fingerprint,username,global_name
         ) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(bot_identity_id) DO UPDATE SET
           token_ciphertext=EXCLUDED.token_ciphertext,
           token_iv=EXCLUDED.token_iv,
           token_auth_tag=EXCLUDED.token_auth_tag,
           token_fingerprint=EXCLUDED.token_fingerprint,
           username=EXCLUDED.username,
           global_name=EXCLUDED.global_name,
           updated_at=now()`,
        [
          identityId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.fingerprint,
          user.username,
          user.globalName
        ]
      );
    });

    const row = (await this.db.query<{
      client_id: string;
      updated_at: string;
    }>(
      "SELECT client_id,updated_at FROM bot_identities WHERE id=$1",
      [identityId]
    )).rows[0];

    return {
      identityId,
      clientId: row?.client_id ?? discordClientId,
      username: user.username,
      globalName: user.globalName,
      credentialConfigured: true,
      updatedAt: row?.updated_at ?? null,
      created
    };
  }

  private encrypt(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      authTag: authTag.toString("base64url"),
      fingerprint: createHash("sha256").update(token, "utf8").digest("hex")
    };
  }

  private decrypt(row: StoredCredential): string {
    const iv = Buffer.from(row.token_iv, "base64url");
    const ciphertext = Buffer.from(row.token_ciphertext, "base64url");
    const authTag = Buffer.from(row.token_auth_tag, "base64url");
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error("invalid_stored_bot_credential");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("bot_credential_decryption_failed");
    }
  }
}

export function normalizeIdentityId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "primary") return normalized;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error("invalid_bot_identity_id");
  }
  return normalized;
}

export function normalizeToken(value: string): string {
  const token = value.trim();
  if (token.length < 20 || token.length > 256) {
    throw new Error("invalid_discord_token");
  }
  return token;
}

export async function validateDiscordBotToken(token: string): Promise<{
  id: string;
  username: string | null;
  globalName: string | null;
}> {
  let response: Response;
  try {
    response = await fetch(DISCORD_API, {
      method: "GET",
      headers: {
        Authorization: "Bot " + token,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error("discord_token_validation_unreachable");
  }

  if (response.status === 401) throw new Error("invalid_discord_token");
  if (!response.ok) throw new Error("discord_token_validation_failed");

  let body: DiscordBotUser;
  try {
    body = await response.json() as DiscordBotUser;
  } catch {
    throw new Error("discord_token_validation_invalid_response");
  }

  if (body.bot !== true || typeof body.id !== "string" || !/^\d{17,20}$/.test(body.id)) {
    throw new Error("discord_token_not_a_bot");
  }

  return {
    id: body.id,
    username: typeof body.username === "string" ? body.username : null,
    globalName: typeof body.global_name === "string" ? body.global_name : null
  };
}
