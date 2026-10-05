import type { ProviderCredentialSecret } from "./integration-credentials.js";

const TIKTOK_API_BASE = "https://open.tiktokapis.com";
const TIKTOK_VIDEO_FIELDS = [
  "id",
  "create_time",
  "cover_image_url",
  "share_url",
  "video_description",
  "duration",
  "title",
  "embed_link"
].join(",");

export type TikTokDisplayVideo = {
  id: string;
  createTime: number;
  title: string;
  description: string;
  shareUrl: string;
  embedLink: string;
  coverImageUrl: string;
  duration: number | null;
};

export type TikTokDisplayProfile = {
  openId: string;
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
  bio: string;
};

export type TikTokCredentialStore = ProviderCredentialSecret & {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  openId?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  scope?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export class TikTokDisplayClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async listRecentVideos(
    credential: TikTokCredentialStore,
    options: {
      cursor?: number;
      maxCount?: number;
      persist?: (credential: TikTokCredentialStore) => Promise<void>;
    } = {}
  ): Promise<{ videos: TikTokDisplayVideo[]; cursor: number; hasMore: boolean }> {
    const active = await this.ensureFreshAccessToken(credential, options.persist);
    const maxCount = Math.min(20, Math.max(1, Math.trunc(options.maxCount ?? 20)));
    const body: Record<string, unknown> = { max_count: maxCount };
    if (options.cursor !== undefined) body.cursor = Math.max(0, Math.trunc(options.cursor));

    const url = new URL("/v2/video/list/", TIKTOK_API_BASE);
    url.searchParams.set("fields", TIKTOK_VIDEO_FIELDS);
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + active.accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) throw new Error("tiktok_video_list_http_" + response.status);
    const payload = await response.json() as {
      data?: { videos?: unknown[]; cursor?: number; has_more?: boolean };
      error?: { code?: string; message?: string };
    };
    if (payload.error?.code && payload.error.code !== "ok") {
      throw new Error("tiktok_video_list_" + payload.error.code);
    }

    return {
      videos: normalizeTikTokVideos(payload.data?.videos),
      cursor: Number(payload.data?.cursor ?? 0),
      hasMore: Boolean(payload.data?.has_more)
    };
  }

  async getProfile(
    credential: TikTokCredentialStore,
    persist?: (credential: TikTokCredentialStore) => Promise<void>
  ): Promise<TikTokDisplayProfile> {
    const active = await this.ensureFreshAccessToken(credential, persist);
    const url = new URL("/v2/user/info/", TIKTOK_API_BASE);
    url.searchParams.set("fields", "open_id,avatar_url,display_name,profile_deep_link,bio_description");
    const response = await this.fetcher(url, {
      headers: { Authorization: "Bearer " + active.accessToken },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("tiktok_user_info_http_" + response.status);

    const payload = await response.json() as {
      data?: {
        user?: {
          open_id?: string;
          avatar_url?: string;
          display_name?: string;
          profile_deep_link?: string;
          bio_description?: string;
        };
      };
      error?: { code?: string; message?: string };
    };
    if (payload.error?.code && payload.error.code !== "ok") {
      throw new Error("tiktok_user_info_" + payload.error.code);
    }

    const user = payload.data?.user;
    if (!user?.open_id) throw new Error("tiktok_user_info_missing_open_id");

    return {
      openId: user.open_id,
      displayName: String(user.display_name ?? ""),
      avatarUrl: String(user.avatar_url ?? ""),
      profileUrl: String(user.profile_deep_link ?? ""),
      bio: String(user.bio_description ?? "")
    };
  }

  private async ensureFreshAccessToken(
    credential: TikTokCredentialStore,
    persist?: (credential: TikTokCredentialStore) => Promise<void>
  ): Promise<TikTokCredentialStore> {
    const expiresAt = Number(credential.expiresAt ?? 0);
    if (!expiresAt || expiresAt > Date.now() + 15 * 60_000) return credential;

    if (!credential.refreshToken) throw new Error("tiktok_refresh_token_missing");
    if (credential.refreshExpiresAt && credential.refreshExpiresAt <= Date.now()) {
      throw new Error("tiktok_refresh_token_expired");
    }

    const body = new URLSearchParams({
      client_key: credential.clientId,
      client_secret: credential.clientSecret,
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken
    });
    const response = await this.fetcher(new URL("/v2/oauth/token/", TIKTOK_API_BASE), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("tiktok_refresh_http_" + response.status);

    const token = await response.json() as TokenResponse;
    if (!token.access_token || !token.refresh_token) {
      throw new Error("tiktok_refresh_token_response_invalid");
    }

    const refreshed: TikTokCredentialStore = {
      ...credential,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      ...(token.open_id ? { openId: token.open_id } : {}),
      ...(token.scope ? { scope: token.scope } : {}),
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in ?? 86_400)) * 1000,
      refreshExpiresAt: Date.now() + Math.max(60, Number(token.refresh_expires_in ?? 31_536_000)) * 1000
    };

    await persist?.(refreshed);
    return refreshed;
  }
}

export function normalizeTikTokVideos(value: unknown): TikTokDisplayVideo[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) return [];

    const createTime = Number(row.create_time);
    const duration = Number(row.duration);

    return [{
      id,
      createTime: Number.isFinite(createTime) ? Math.max(0, Math.trunc(createTime)) : 0,
      title: String(row.title ?? ""),
      description: String(row.video_description ?? ""),
      shareUrl: String(row.share_url ?? ""),
      embedLink: String(row.embed_link ?? ""),
      coverImageUrl: String(row.cover_image_url ?? ""),
      duration: Number.isFinite(duration) && duration >= 0 ? Math.trunc(duration) : null
    }];
  });
}
