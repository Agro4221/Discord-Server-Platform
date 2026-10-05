import { resolveIdentityEnv } from "./bot-identity.js";

export type AppConfig = {
  discordToken: string;
  discordClientId: string;
  botIdentityId: string;
  discordTestGuildId?: string;
  healthHost: string;
  healthPort: number;
  managementApiHost: string;
  managementApiPort: number;
  managementApiKey: string;
  databaseUrl: string;
  lavalinkHost: string;
  lavalinkPort: number;
  lavalinkPassword: string;
  lavalinkNodes: Array<{ id: string; host: string; port: number; password: string; secure?: boolean }>;
  backupDirectory: string;
  backupRetentionCount: number;
  streamAlerts: {
    twitchClientId?: string;
    twitchClientSecret?: string;
    youtubeApiKey?: string;
    kickClientId?: string;
    kickClientSecret?: string;
    vkApiBaseUrl: string;
    pollIntervalSeconds: number;
  };
  backupS3?: {
    endpoint: string;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  nodeEnv: "development" | "test" | "production";
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredNonBlank(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port environment variable: ${name}`);
  }
  return parsed;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return value;
}

function parseBackupS3(): AppConfig["backupS3"] | null {
  const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim();
  const bucket = process.env.BACKUP_S3_BUCKET?.trim();
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  const anyConfigured = Boolean(endpoint || bucket || accessKeyId || secretAccessKey);
  if (!anyConfigured) return null;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY must be provided together");
  }
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("BACKUP_S3_ENDPOINT must be a valid URL"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BACKUP_S3_ENDPOINT must use http or https");
  }
  return {
    endpoint: url.toString().replace(/\/$/, ""),
    region: process.env.BACKUP_S3_REGION?.trim() || "us-east-1",
    prefix: process.env.BACKUP_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") ?? "",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE !== "false"
  };
}

function parseLavalinkNodes(): AppConfig["lavalinkNodes"] {
  const raw = process.env.LAVALINK_NODES;
  if (!raw?.trim()) {
    return [{
      id: "local",
      host: process.env.LAVALINK_HOST ?? "127.0.0.1",
      port: port("LAVALINK_PORT", 2333),
      password: required("LAVALINK_PASSWORD"),
      ...(process.env.LAVALINK_SECURE === "true" ? { secure: true } : {})
    }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("LAVALINK_NODES must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 16) {
    throw new Error("LAVALINK_NODES must contain 1..16 nodes");
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid Lavalink node at index ${index}`);
    }
    const node = item as Record<string, unknown>;
    if (
      typeof node.id !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(node.id) ||
      typeof node.host !== "string" || !node.host.trim() ||
      typeof node.port !== "number" || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535 ||
      typeof node.password !== "string" || !node.password
    ) {
      throw new Error(`Invalid Lavalink node at index ${index}`);
    }
    if (node.secure !== undefined && typeof node.secure !== "boolean") {
      throw new Error(`Invalid Lavalink secure flag at index ${index}`);
    }
    return {
      id: node.id,
      host: node.host.trim(),
      port: node.port,
      password: node.password,
      ...(node.secure === true ? { secure: true } : {})
    };
  });
}

export function loadConfig(): AppConfig {
  const backupS3 = parseBackupS3();
  const botIdentityId = process.env.BOT_IDENTITY_ID ?? "primary";
  const discordCredentials = resolveIdentityEnv(botIdentityId);
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const managementApiHost = process.env.MANAGEMENT_API_HOST ?? "127.0.0.1";
  const containerized = process.env.DSP_CONTAINERIZED === "true";
  if (
    nodeEnv === "production" &&
    !["127.0.0.1", "::1", "localhost"].includes(managementApiHost) &&
    !(containerized && managementApiHost === "0.0.0.0")
  ) {
    throw new Error("MANAGEMENT_API_HOST must be loopback in production unless the container network is explicitly enabled");
  }

  if (nodeEnv === "production" && backupS3 && !backupS3.endpoint.startsWith("https://")) {
    throw new Error("BACKUP_S3_ENDPOINT must use HTTPS in production");
  }

  return {
    discordToken: discordCredentials.token ?? "",
    discordClientId: discordCredentials.clientId ?? "",
    botIdentityId,
    ...(process.env.DISCORD_TEST_GUILD_ID ? { discordTestGuildId: process.env.DISCORD_TEST_GUILD_ID } : {}),
    healthHost: process.env.HEALTH_HOST ?? "127.0.0.1",
    healthPort: port("HEALTH_PORT", 3001),
    managementApiHost,
    managementApiPort: port("MANAGEMENT_API_PORT", 3002),
    managementApiKey: requiredNonBlank("MANAGEMENT_API_KEY"),
    databaseUrl: required("DATABASE_URL"),
    lavalinkHost: process.env.LAVALINK_HOST ?? "127.0.0.1",
    lavalinkPort: port("LAVALINK_PORT", 2333),
    lavalinkPassword: required("LAVALINK_PASSWORD"),
    lavalinkNodes: parseLavalinkNodes(),
    backupDirectory: process.env.BACKUP_DIRECTORY ?? "./data/backups",
    backupRetentionCount: integer("BACKUP_RETENTION_COUNT", 30, 1, 10_000),
    ...(backupS3 ? { backupS3 } : {}),
    streamAlerts: {
      ...(process.env.TWITCH_CLIENT_ID?.trim() ? { twitchClientId: process.env.TWITCH_CLIENT_ID.trim() } : {}),
      ...(process.env.TWITCH_CLIENT_SECRET?.trim() ? { twitchClientSecret: process.env.TWITCH_CLIENT_SECRET.trim() } : {}),
      ...(process.env.YOUTUBE_API_KEY?.trim() ? { youtubeApiKey: process.env.YOUTUBE_API_KEY.trim() } : {}),
      ...(process.env.KICK_CLIENT_ID?.trim() ? { kickClientId: process.env.KICK_CLIENT_ID.trim() } : {}),
      ...(process.env.KICK_CLIENT_SECRET?.trim() ? { kickClientSecret: process.env.KICK_CLIENT_SECRET.trim() } : {}),
      vkApiBaseUrl: (process.env.VK_VIDEO_LIVE_API_BASE_URL?.trim() || "https://api.live.vkvideo.ru/v1").replace(/\/$/, ""),
      pollIntervalSeconds: integer("STREAM_ALERTS_POLL_INTERVAL_SECONDS", 30, 15, 300)
    },
    nodeEnv
  };
}
