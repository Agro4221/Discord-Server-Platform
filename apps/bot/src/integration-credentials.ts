import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Database } from "./database.js";

export type IntegrationCredentialProvider = "twitch" | "youtube" | "kick" | "tiktok";
export type IntegrationCredentialInput = {
  provider: IntegrationCredentialProvider;
  label: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  openId?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  scope?: string;
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
  accessToken?: string;
  refreshToken?: string;
  openId?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  scope?: string;
};

export class IntegrationCredentialRepository {
  private readonly key: Buffer;

  constructor(
    private readonly db: Database,
    secret: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
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

  async test(guildId: string, id: number): Promise<{ provider: IntegrationCredentialProvider; latencyMs: number }> {
    const result = await this.db.query<{
      provider: IntegrationCredentialProvider;
      secret_ciphertext: string;
    }>(
      "SELECT provider,secret_ciphertext FROM integration_credentials WHERE id=$1 AND guild_id=$2",
      [id, guildId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("integration_credential_not_found");

    const secret = this.decrypt(row.secret_ciphertext);
    normalizeSecret(row.provider, secret);
    const startedAt = Date.now();

    if (row.provider === "tiktok") {
      const response = await this.fetcher("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
        headers: { Authorization: "Bearer " + secret.accessToken }
      });
      if (!response.ok) throw new Error("integration_credential_test_http_" + response.status);
      return { provider: row.provider, latencyMs: Math.max(0, Date.now() - startedAt) };
    }

    if (row.provider === "twitch" || row.provider === "kick") {
      const clientId = secret.clientId!;
      const clientSecret = secret.clientSecret!;
      const url = row.provider === "twitch"
        ? "https://id.twitch.tv/oauth2/token"
        : "https://id.kick.com/oauth/token";
      const body = row.provider === "twitch"
        ? new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
        : new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("integration_credential_test_http_" + response.status);
      const payload = await response.json() as { access_token?: string };
      if (!payload.access_token) throw new Error("integration_credential_test_token_missing");
    } else {
      const params = new URLSearchParams({
        part: "id",
        chart: "mostPopular",
        maxResults: "1",
        key: secret.apiKey!
      });
      const response = await this.fetcher("https://www.googleapis.com/youtube/v3/videos?" + params.toString(), {
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("integration_credential_test_http_" + response.status);
    }

    return { provider: row.provider, latencyMs: Math.max(0, Date.now() - startedAt) };
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
    const ivValue = parts[0];
    const tagValue = parts[1];
    const encryptedValue = parts[2];
    if (!ivValue || !tagValue || !encryptedValue) throw new Error("invalid_integration_credential_ciphertext");
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

export function normalizeCredentialInput(input: IntegrationCredentialInput): { provider: IntegrationCredentialProvider; label: string; secret: ProviderCredentialSecret } {
  if (!["twitch", "youtube", "kick", "tiktok"].includes(input.provider)) throw new Error("invalid_integration_credential_provider");
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) throw new Error("invalid_integration_credential_label");
  const secret: ProviderCredentialSecret = {
    ...(input.clientId !== undefined ? { clientId: input.clientId.trim() } : {}),
    ...(input.clientSecret !== undefined ? { clientSecret: input.clientSecret } : {}),
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey.trim() } : {}),
    ...(input.accessToken !== undefined ? { accessToken: input.accessToken.trim() } : {}),
    ...(input.refreshToken !== undefined ? { refreshToken: input.refreshToken.trim() } : {}),
    ...(input.openId !== undefined ? { openId: input.openId.trim() } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: Number(input.expiresAt) } : {}),
    ...(input.refreshExpiresAt !== undefined ? { refreshExpiresAt: Number(input.refreshExpiresAt) } : {}),
    ...(input.scope !== undefined ? { scope: input.scope.trim() } : {})
  };
  normalizeSecret(input.provider, secret);
  return { provider: input.provider, label, secret };
}

function normalizeSecret(provider: IntegrationCredentialProvider, secret: ProviderCredentialSecret): void {
  if (provider === "tiktok") {
    if (!secret.clientId || !secret.clientSecret || secret.clientId.length > 256 || secret.clientSecret.length > 512) {
      throw new Error("invalid_tiktok_client_credentials");
    }
    if (!secret.accessToken || secret.accessToken.length > 4096) throw new Error("invalid_tiktok_access_token");
    if (!secret.refreshToken || secret.refreshToken.length > 4096) throw new Error("invalid_tiktok_refresh_token");
    if (secret.openId !== undefined && secret.openId.length > 256) throw new Error("invalid_tiktok_open_id");
    if (secret.scope !== undefined && secret.scope.length > 1024) throw new Error("invalid_tiktok_scope");
    return;
  }
  if (provider === "youtube") {
    if (!secret.apiKey || secret.apiKey.length > 512) throw new Error("invalid_youtube_api_key");
    return;
  }
  if (!secret.clientId || !secret.clientSecret || secret.clientId.length > 256 || secret.clientSecret.length > 512) {
    throw new Error(provider === "twitch" ? "invalid_twitch_credentials" : "invalid_kick_credentials");
  }
}