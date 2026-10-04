import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Database } from "./database.js";

export type IntegrationCredentialProvider = "twitch" | "youtube" | "kick";
export type IntegrationCredentialInput = {
  provider: IntegrationCredentialProvider;
  label: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
};
export type IntegrationCredentialRecord = {
  id: number;
  guildId: string;
  provider: IntegrationCredentialProvider;
  label: string;
  createdAt: string;
  updatedAt: string;
};
export type ProviderCredentialSecret = {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
};

export class IntegrationCredentialRepository {
  private readonly key: Buffer;

  constructor(private readonly db: Database, secret: string) {
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  async list(guildId: string): Promise<IntegrationCredentialRecord[]> {
    const result = await this.db.query<{
      id: string; guild_id: string; provider: IntegrationCredentialProvider; label: string; created_at: string; updated_at: string;
    }>(
      "SELECT id,guild_id,provider,label,created_at,updated_at FROM integration_credentials WHERE guild_id=$1 ORDER BY provider,label,id",
      [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      provider: row.provider,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async save(guildId: string, input: IntegrationCredentialInput): Promise<IntegrationCredentialRecord> {
    const normalized = normalizeCredentialInput(input);
    const ciphertext = this.encrypt(normalized.secret);
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO integration_credentials(guild_id,provider,label,secret_ciphertext)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(guild_id,provider,label) DO UPDATE SET
         secret_ciphertext=EXCLUDED.secret_ciphertext,
         updated_at=now()
       RETURNING id`,
      [guildId, normalized.provider, normalized.label, ciphertext]
    );
    const id = Number(result.rows[0]?.id);
    const record = (await this.list(guildId)).find((item) => item.id === id);
    if (!record) throw new Error("integration_credential_save_failed");
    return record;
  }

  async getSecret(guildId: string, id: number, provider: IntegrationCredentialProvider): Promise<ProviderCredentialSecret | null> {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    const result = await this.db.query<{ secret_ciphertext: string }>(
      "SELECT secret_ciphertext FROM integration_credentials WHERE id=$1 AND guild_id=$2 AND provider=$3",
      [id, guildId, provider]
    );
    const value = result.rows[0]?.secret_ciphertext;
    if (!value) return null;
    const secret = this.decrypt(value);
    normalizeSecret(provider, secret);
    return secret;
  }

  async delete(guildId: string, id: number): Promise<boolean> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("invalid_integration_credential_id");
    const result = await this.db.query(
      "DELETE FROM integration_credentials WHERE id=$1 AND guild_id=$2",
      [id, guildId]
    );
    return result.rowCount === 1;
  }

  private encrypt(secret: ProviderCredentialSecret): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.from(JSON.stringify(secret), "utf8");
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }

  private decrypt(value: string): ProviderCredentialSecret {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error("invalid_integration_credential_ciphertext");
    const [ivValue, tagValue, encryptedValue] = parts;
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const encrypted = Buffer.from(encryptedValue, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid_integration_credential_ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_integration_credential_secret");
    return parsed as ProviderCredentialSecret;
  }
}

function normalizeCredentialInput(input: IntegrationCredentialInput): { provider: IntegrationCredentialProvider; label: string; secret: ProviderCredentialSecret } {
  if (!["twitch", "youtube", "kick"].includes(input.provider)) throw new Error("invalid_integration_credential_provider");
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) throw new Error("invalid_integration_credential_label");
  const secret: ProviderCredentialSecret = {
    ...(input.clientId !== undefined ? { clientId: input.clientId.trim() } : {}),
    ...(input.clientSecret !== undefined ? { clientSecret: input.clientSecret } : {}),
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey.trim() } : {})
  };
  normalizeSecret(input.provider, secret);
  return { provider: input.provider, label, secret };
}

function normalizeSecret(provider: IntegrationCredentialProvider, secret: ProviderCredentialSecret): void {
  if (provider === "youtube") {
    if (!secret.apiKey || secret.apiKey.length > 512) throw new Error("invalid_youtube_api_key");
    return;
  }
  if (!secret.clientId || !secret.clientSecret || secret.clientId.length > 256 || secret.clientSecret.length > 512) {
    throw new Error(provider === "twitch" ? "invalid_twitch_credentials" : "invalid_kick_credentials");
  }
}