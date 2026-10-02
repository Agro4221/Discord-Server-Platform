import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Client } from "discord.js";
import { Store, type StreamSource } from "./db.js";
import { config } from "./config.js";
import { renderTemplate } from "./format.js";

const execFileAsync = promisify(execFile);

function twitchLogin(identifier: string): string {
  const value = identifier.trim();

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === "twitch.tv" || url.hostname.toLowerCase().endsWith(".twitch.tv")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    // Treat it as a login.
  }

  return value.replace(/^@/, "").replace(/^\//, "").split(/[?#/]/, 1)[0] ?? "";
}

function vkSlug(identifier: string): string {
  const value = identifier.trim();

  try {
    const url = new URL(value);
    if (
      url.hostname.toLowerCase() === "live.vkvideo.ru" ||
      url.hostname.toLowerCase().endsWith(".vkvideo.ru")
    ) {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    // Treat it as a slug.
  }

  return value.replace(/^@/, "").replace(/^\//, "").split(/[?#/]/, 1)[0] ?? "";
}

function youtubeLiveUrl(identifier: string): string {
  const value = identifier.trim();

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();

      if (
        host === "youtu.be" ||
        url.pathname.startsWith("/watch") ||
        url.pathname.startsWith("/live/")
      ) {
        return value;
      }

      if (
        host === "youtube.com" ||
        host === "www.youtube.com" ||
        host.endsWith(".youtube.com")
      ) {
        if (
          url.pathname.startsWith("/@") ||
          url.pathname.startsWith("/channel/") ||
          url.pathname.startsWith("/c/") ||
          url.pathname.startsWith("/user/")
        ) {
          url.pathname = url.pathname.replace(/\/$/, "") + "/live";
          return url.toString();
        }
      }
    } catch {
      return value;
    }

    return value;
  }

  if (value.startsWith("@")) {
    return "https://www.youtube.com/" +
      encodeURIComponent(value) +
      "/live";
  }

  return "https://www.youtube.com/channel/" +
    encodeURIComponent(value) +
    "/live";
}

type LiveInfo = {
  liveId: string;
  title: string;
  url: string;
  viewers?: number;
  category?: string;
  thumbnail?: string;
};

type YtDlpLiveEntry = {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  thumbnail?: string;
  live_status?: string;
  is_live?: boolean;
  concurrent_view_count?: number;
  categories?: string[];
};

function childProcessErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);

  const value = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };

  return [
    typeof value.message === "string" ? value.message : "",
    typeof value.stderr === "string" ? value.stderr : "",
    typeof value.stdout === "string" ? value.stdout : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeDiscordText(value: string): string {
  return value
    .replace(/[\\*_~|>]/g, "\\$&")
    .replaceAll(String.fromCharCode(96), "\\" + String.fromCharCode(96));
}

function announcementColor(provider: StreamSource["provider"]): number {
  if (provider === "twitch") return 0x9146ff;
  if (provider === "youtube") return 0xff0000;
  return 0x0077ff;
}

export class AnnouncementService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private twitchToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly client: Client,
    private readonly store: Store
  ) {}

  start(): void {
    if (this.timer) return;

    void this.poll();
    this.timer = setInterval(() => void this.poll(), config.pollIntervalMs);
  }

  async pollNow(): Promise<void> {
    await this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const sources = this.store.listStreamSources().filter((item) => item.enabled);

      for (const source of sources) {
        try {
          const live = await this.fetchLive(source);
          if (!live || live.liveId === source.lastLiveId) continue;

          const channel = this.client.channels.cache.get(source.discordChannelId);
          if (
            !channel ||
            !channel.isTextBased() ||
            !("send" in channel) ||
            typeof channel.send !== "function"
          ) {
            console.warn(
              "[announcements] target channel is not sendable: " + source.discordChannelId
            );
            continue;
          }

          const platform =
            source.provider === "twitch"
              ? "Twitch"
              : source.provider === "youtube"
                ? "YouTube"
                : "VK Видео Live";

          const headline =
            source.displayName +
            " запустил вещание на " +
            platform +
            "!";

          const legacyDefaultTemplate =
            "🔴 {platform} · {channel} сейчас в эфире!\\n{title}\\n{url}";
          const configuredTemplate =
            source.template === legacyDefaultTemplate
              ? "{channel} запустил вещание на {platform}!\\n<{url}>"
              : source.template;

          const content = renderTemplate(configuredTemplate, {
            platform,
            channel: escapeDiscordText(source.displayName),
            title: escapeDiscordText(live.title),
            url: live.url,
            viewers: live.viewers,
            category: live.category
          }).replaceAll("\\n", "\n");

          const descriptionParts = [
            "**" + live.title.slice(0, 900) + "**"
          ];

          if (live.viewers !== undefined) {
            descriptionParts.push("**Зрителей:** " + live.viewers);
          }

          if (live.category) {
            descriptionParts.push("**Игра:** " + live.category.slice(0, 900));
          }

          await channel.send({
            content: content.slice(0, 4000),
            embeds: [{
              title: headline.slice(0, 256),
              url: live.url,
              description: descriptionParts.join("\n\n").slice(0, 4000),
              color: announcementColor(source.provider),
              ...(live.thumbnail
                ? { thumbnail: { url: live.thumbnail } }
                : {})
            }]
          });

          this.store.setLastLiveId(source.id, live.liveId);
        } catch (error) {
          console.error(
            "[announcements] " + source.provider + "/" + source.identifier,
            error
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private fetchLive(source: StreamSource): Promise<LiveInfo | null> {
    if (source.provider === "twitch") {
      return this.fetchTwitch(source.identifier);
    }
    if (source.provider === "youtube") {
      return this.fetchYouTube(source.identifier);
    }
    return this.fetchVk(source.identifier);
  }

  private async fetchTwitch(identifier: string): Promise<LiveInfo | null> {
    if (!config.twitchClientId || !config.twitchClientSecret) {
      throw new Error(
        "Twitch не настроен: укажи TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET в .env."
      );
    }

    const resolvedLogin = twitchLogin(identifier);
    if (!resolvedLogin) {
      throw new Error(
        "Не удалось определить Twitch login из идентификатора: " + identifier
      );
    }

    const now = Date.now();

    if (!this.twitchToken || this.twitchToken.expiresAt <= now + 30_000) {
      const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: config.twitchClientId,
          client_secret: config.twitchClientSecret,
          grant_type: "client_credentials"
        })
      });

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text();
        throw new Error(
          "Twitch token " + tokenResponse.status + ": " + body.slice(0, 500)
        );
      }

      const token = await tokenResponse.json() as {
        access_token: string;
        expires_in: number;
      };

      this.twitchToken = {
        value: token.access_token,
        expiresAt: now + token.expires_in * 1000
      };
    }

    const userResponse = await fetch(
      "https://api.twitch.tv/helix/users?login=" +
        encodeURIComponent(resolvedLogin),
      {
        headers: {
          "Client-Id": config.twitchClientId,
          "Authorization": "Bearer " + this.twitchToken.value
        }
      }
    );

    if (!userResponse.ok) {
      const body = await userResponse.text();
      throw new Error(
        "Twitch users " + userResponse.status + ": " + body.slice(0, 500)
      );
    }

    const users = await userResponse.json() as {
      data: Array<{
        id: string;
        login: string;
        display_name: string;
      }>;
    };

    const user = users.data[0];
    if (!user) return null;

    const response = await fetch(
      "https://api.twitch.tv/helix/streams?user_id=" +
        encodeURIComponent(user.id) +
        "&first=1",
      {
        headers: {
          "Client-Id": config.twitchClientId,
          "Authorization": "Bearer " + this.twitchToken.value
        }
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        "Twitch streams " + response.status + ": " + body.slice(0, 500)
      );
    }

    const json = await response.json() as {
      data: Array<{
        id: string;
        title: string;
        viewer_count: number;
        game_name: string;
        thumbnail_url: string;
      }>;
    };

    const stream = json.data[0];
    if (!stream) return null;

    return {
      liveId: stream.id,
      title: stream.title,
      url: "https://www.twitch.tv/" + encodeURIComponent(user.login),
      viewers: stream.viewer_count,
      category: stream.game_name,
      thumbnail: stream.thumbnail_url
        .replace("{width}", "640")
        .replace("{height}", "360")
    };
  }

  private async fetchYouTube(identifier: string): Promise<LiveInfo | null> {
    const liveUrl = youtubeLiveUrl(identifier);

    try {
      const result = await execFileAsync(config.ytdlpPath, [
        liveUrl,
        "--flat-playlist",
        "--playlist-end", "1",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings"
      ], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000
      });

      const data = JSON.parse(String(result.stdout)) as YtDlpLiveEntry & {
        entries?: YtDlpLiveEntry[];
      };

      const entry = data.entries?.[0];
      const id = data.id || entry?.id;

      if (!id) return null;

      const liveStatus = data.live_status || entry?.live_status;
      const isLive =
        data.is_live === true ||
        entry?.is_live === true ||
        liveStatus === "is_live" ||
        liveStatus === "live" ||
        !liveStatus;

      if (!isLive) return null;

      return {
        liveId: id,
        title: data.title || entry?.title || "YouTube Live",
        url:
          data.webpage_url ||
          entry?.webpage_url ||
          entry?.url ||
          "https://www.youtube.com/watch?v=" + id,
        viewers:
          data.concurrent_view_count ??
          entry?.concurrent_view_count,
        category:
          data.categories?.[0] ||
          entry?.categories?.[0],
        thumbnail:
          data.thumbnail ||
          entry?.thumbnail
      };
    } catch (error) {
      const message = childProcessErrorText(error);

      if (
        /not currently live|not live|offline|no live|does not currently have a live/i.test(
          message
        )
      ) {
        return null;
      }

      throw new Error("YouTube Live не удалось проверить: " + message.slice(0, 500));
    }
  }

  private async fetchVk(slug: string): Promise<LiveInfo | null> {
    const resolvedSlug = vkSlug(slug);
    if (!resolvedSlug) {
      throw new Error(
        "Не удалось определить VK Видео Live slug из идентификатора: " + slug
      );
    }

    const apiUrl =
      "https://api.live.vkvideo.ru/v1/blog/" +
      encodeURIComponent(resolvedSlug) +
      "/public_video_stream";

    try {
      const response = await fetch(apiUrl, {
        headers: {
          "Referer": "https://live.vkvideo.ru/" + encodeURIComponent(resolvedSlug),
          "user-agent": "stream-bot-lite/0.1"
        }
      });

      if (response.ok) {
        const json = await response.json() as {
          title?: string;
          category?: { title?: string };
          data?: Array<{
            vid?: string;
            playerUrls?: Array<{
              type?: string;
              url?: string;
            }>;
          }>;
        };

        const live = json.data?.[0];
        if (live?.vid) {
          return {
            liveId: live.vid,
            title: json.title || "VK Видео Live",
            url: "https://live.vkvideo.ru/" + encodeURIComponent(resolvedSlug),
            category: json.category?.title
          };
        }

        return null;
      }
    } catch (error) {
      console.warn("[announcements] VK API request failed, trying yt-dlp:", error);
    }

    // VK has changed the public web endpoint over time. Current yt-dlp includes
    // a VK Video Live extractor, so use it as a fallback for live detection.
    try {
      const liveUrl =
        "https://live.vkvideo.ru/" + encodeURIComponent(resolvedSlug);

      const result = await execFileAsync(config.ytdlpPath, [
        liveUrl,
        "--dump-single-json",
        "--skip-download",
        "--no-warnings"
      ], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000
      });

      const data = JSON.parse(String(result.stdout)) as {
        id?: string;
        title?: string;
        webpage_url?: string;
        thumbnail?: string;
        live_status?: string;
        is_live?: boolean;
        concurrent_view_count?: number;
        categories?: string[];
      };

      const isLive =
        data.live_status === "is_live" ||
        data.live_status === "live" ||
        data.is_live === true;

      if (!isLive || !data.id) return null;

      return {
        liveId: data.id,
        title: data.title || "VK Видео Live",
        url: data.webpage_url || liveUrl,
        viewers: data.concurrent_view_count,
        category: data.categories?.[0],
        thumbnail: data.thumbnail
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not live|offline|no live|does not currently have a live/i.test(message)) {
        return null;
      }

      throw new Error("VK Video Live не удалось проверить через API и yt-dlp: " + message);
    }
  }

}