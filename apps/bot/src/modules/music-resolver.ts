import { spawn } from "node:child_process";
import { logger } from "../logger.js";

export type NativeMusicProvider =
  | "youtube"
  | "youtube_music"
  | "soundcloud"
  | "spotify"
  | "yandex_music"
  | "vkontakte"
  | "tiktok"
  | "generic";

export type NativeMusicTrack = {
  title: string;
  author: string;
  durationMs: number;
  url: string;
  source: string;
  artworkUrl: string | null;
};

export type NativeMusicResolution = {
  track: NativeMusicTrack;
  playbackQuery: string;
  provider: NativeMusicProvider;
  strategy: "direct" | "search";
  fallbackUsed: boolean;
  requestedQuery: string;
};

type YtDlpFormat = {
  url?: unknown;
  acodec?: unknown;
  vcodec?: unknown;
};

type YtDlpMetadata = {
  title?: unknown;
  uploader?: unknown;
  artist?: unknown;
  creator?: unknown;
  channel?: unknown;
  duration?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  url?: unknown;
  extractor_key?: unknown;
  extractor?: unknown;
  thumbnail?: unknown;
  entries?: unknown;
  formats?: unknown;
  _type?: unknown;
};

type SearchAttempt = {
  provider: NativeMusicProvider;
  lookup: string;
};

const RESOLVE_TIMEOUT_MS = 20_000;

const URL_PROVIDER_RULES: Array<{ pattern: RegExp; provider: NativeMusicProvider }> = [
  { pattern: /(?:^|\.)music\.youtube\.com$/i, provider: "youtube_music" },
  { pattern: /(?:^|\.)youtube\.com$/i, provider: "youtube" },
  { pattern: /(?:^|\.)youtu\.be$/i, provider: "youtube" },
  { pattern: /(?:^|\.)soundcloud\.com$/i, provider: "soundcloud" },
  { pattern: /(?:^|\.)open\.spotify\.com$/i, provider: "spotify" },
  { pattern: /(?:^|\.)spotify\.com$/i, provider: "spotify" },
  { pattern: /(?:^|\.)music\.yandex\.(?:ru|com|kz|by)$/i, provider: "yandex_music" },
  { pattern: /(?:^|\.)vk\.com$/i, provider: "vkontakte" },
  { pattern: /(?:^|\.)vkvideo\.ru$/i, provider: "vkontakte" },
  { pattern: /(?:^|\.)tiktok\.com$/i, provider: "tiktok" }
];

export class NativeMusicResolver {
  constructor(
    private readonly ytDlpPath = process.env.YTDLP_PATH?.trim() || "yt-dlp"
  ) {}

  async resolve(query: string): Promise<NativeMusicResolution> {
    const requestedQuery = query.trim();
    if (!requestedQuery) throw new Error("music_query_empty");

    if (isHttpUrl(requestedQuery)) {
      return this.resolveUrl(requestedQuery);
    }

    return this.resolveSearch(requestedQuery, requestedQuery);
  }

  private async resolveUrl(
    url: string
  ): Promise<NativeMusicResolution> {
    const requestedProvider = detectNativeMusicProvider(url);

    let metadata: YtDlpMetadata;
    try {
      metadata = await this.resolveMetadata(url);
    } catch (error) {
      logger.warn("Native Music direct URL resolution failed", {
        url,
        provider: requestedProvider,
        error: String(error)
      });
      throw error;
    }

    const entry = pickFirstEntry(metadata);
    const directTrack = buildNativeMusicTrack(entry, url, requestedProvider);

    if (isPlayableNativeMusicMetadata(entry)) {
      return {
        track: directTrack,
        playbackQuery: url,
        provider: requestedProvider,
        strategy: "direct",
        fallbackUsed: false,
        requestedQuery: url
      };
    }

    const fallbackQuery = buildNativeMusicFallbackQuery(entry);
    if (!fallbackQuery) {
      throw new Error("music_url_not_playable");
    }

    logger.info("Native Music using search mirror for metadata-only URL", {
      url,
      provider: requestedProvider,
      fallbackQuery
    });

    const fallback = await this.resolveSearch(fallbackQuery, url);
    return {
      ...fallback,
      requestedQuery: url,
      fallbackUsed: true
    };
  }

  private async resolveSearch(
    query: string,
    requestedQuery: string
  ): Promise<NativeMusicResolution> {
    let lastError: unknown = null;

    for (const attempt of buildNativeMusicSearchAttempts(query)) {
      try {
        const metadata = await this.resolveMetadata(attempt.lookup, true);
        const entry = pickFirstEntry(metadata);
        if (!isPlayableNativeMusicMetadata(entry)) {
          continue;
        }

        const track = buildNativeMusicTrack(entry, attempt.lookup, attempt.provider);
        const playbackQuery =
          asString(entry.webpage_url) ||
          asString(entry.original_url) ||
          (isHttpUrl(asString(entry.url)) ? asString(entry.url) : "");

        if (!playbackQuery) {
          continue;
        }

        logger.info("Native Music search resolved", {
          query,
          provider: attempt.provider,
          source: track.source,
          title: track.title,
          fallbackUsed: requestedQuery !== query
        });

        return {
          track,
          playbackQuery,
          provider: attempt.provider,
          strategy: "search",
          fallbackUsed: requestedQuery !== query,
          requestedQuery
        };
      } catch (error) {
        lastError = error;
        logger.warn("Native Music search attempt failed", {
          query,
          provider: attempt.provider,
          lookup: attempt.lookup,
          error: String(error)
        });
      }
    }

    if (lastError) throw lastError;
    throw new Error("music_track_not_found");
  }

  private resolveMetadata(lookup: string, allowPlaylistItem = false): Promise<YtDlpMetadata> {
    return new Promise((resolve, reject) => {
      const args = [
        "--quiet",
        "--no-warnings",
        "--skip-download",
        "--dump-single-json",
        ...(allowPlaylistItem ? ["--playlist-items", "1"] : ["--no-playlist"]),
        lookup
      ];
      const child = spawn(this.ytDlpPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (error) {
          reject(error);
          return;
        }

        try {
          resolve(parseJson(Buffer.concat(stdout).toString("utf8").trim()));
        } catch (parseError) {
          reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
        }
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("yt-dlp timed out after " + RESOLVE_TIMEOUT_MS + "ms"));
      }, RESOLVE_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      child.on("error", (error) => finish(error));
      child.on("close", (code) => {
        if (code === 0) {
          finish();
          return;
        }

        const details = Buffer.concat(stderr).toString("utf8").trim();
        finish(new Error(
          "yt-dlp exited with code " + (code ?? "unknown") +
          (details ? ": " + details.slice(0, 1200) : "")
        ));
      });
    });
  }
}

export function detectNativeMusicProvider(query: string): NativeMusicProvider {
  if (!isHttpUrl(query)) return "youtube";

  try {
    const hostname = new URL(query).hostname.toLowerCase().replace(/^www\./, "");
    for (const rule of URL_PROVIDER_RULES) {
      if (rule.pattern.test(hostname)) return rule.provider;
    }
  } catch {
    return "generic";
  }

  return "generic";
}

export function buildNativeMusicSearchAttempts(query: string): SearchAttempt[] {
  const normalized = query.trim();
  if (!normalized) return [];

  return [
    { provider: "youtube", lookup: "ytsearch1:" + normalized },
    {
      provider: "youtube_music",
      lookup: "https://music.youtube.com/search?q=" + encodeURIComponent(normalized)
    },
    { provider: "soundcloud", lookup: "scsearch1:" + normalized }
  ];
}

export function isPlayableNativeMusicMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;

  const source = metadata as YtDlpMetadata;
  if (isHttpUrl(asString(source.url))) return true;

  if (!Array.isArray(source.formats)) return false;
  return source.formats.some((item) => {
    if (!item || typeof item !== "object") return false;
    const format = item as YtDlpFormat;
    const url = asString(format.url);
    if (!isHttpUrl(url)) return false;

    const acodec = asString(format.acodec).toLowerCase();
    const vcodec = asString(format.vcodec).toLowerCase();
    return (
      vcodec === "none" ||
      (acodec !== "" && acodec !== "none") ||
      (acodec === "" && vcodec === "")
    );
  });
}

export function buildNativeMusicFallbackQuery(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;

  const source = metadata as YtDlpMetadata;
  const artist =
    asString(source.artist) ||
    asString(source.uploader) ||
    asString(source.creator) ||
    asString(source.channel);
  const title = asString(source.title);

  const query = [artist, title]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  return query ? query.slice(0, 300) : null;
}

function buildNativeMusicTrack(
  metadata: YtDlpMetadata,
  fallbackUrl: string,
  provider: NativeMusicProvider
): NativeMusicTrack {
  const title = asString(metadata.title) || "Unknown title";
  const author =
    asString(metadata.artist) ||
    asString(metadata.uploader) ||
    asString(metadata.creator) ||
    asString(metadata.channel) ||
    "Unknown artist";
  const duration = asNumber(metadata.duration);
  const url =
    asString(metadata.webpage_url) ||
    asString(metadata.original_url) ||
    fallbackUrl;

  return {
    title,
    author,
    durationMs: Math.max(0, Math.round(duration * 1000)),
    url,
    source: asString(metadata.extractor_key) || asString(metadata.extractor) || provider,
    artworkUrl: asString(metadata.thumbnail) || null
  };
}

function pickFirstEntry(metadata: YtDlpMetadata): YtDlpMetadata {
  if (Array.isArray(metadata.entries)) {
    const first = metadata.entries.find((item) => item && typeof item === "object");
    if (first) return first as YtDlpMetadata;
  }
  return metadata;
}

function parseJson(value: string): YtDlpMetadata {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as YtDlpMetadata;
  } catch {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index];
      if (!line) continue;

      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed && typeof parsed === "object") return parsed as YtDlpMetadata;
      } catch {
        // Try the next line.
      }
    }

    throw new Error("yt-dlp returned invalid JSON metadata");
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export { isHttpUrl };
