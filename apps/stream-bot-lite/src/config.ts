import "dotenv/config";

const configuredYtdlpPath = process.env.YTDLP_PATH?.trim() || "";
const defaultYtdlpPath =
  process.platform === "win32" && (!configuredYtdlpPath || configuredYtdlpPath === "yt-dlp")
    ? "./yt-dlp.exe"
    : configuredYtdlpPath || "yt-dlp";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(name + " must be a positive integer");
  }
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordTestGuildId: process.env.DISCORD_TEST_GUILD_ID?.trim() || "",
  adminHost: process.env.ADMIN_HOST?.trim() || "127.0.0.1",
  adminPort: positiveInt("ADMIN_PORT", 3001),
  adminUsername: process.env.ADMIN_USERNAME?.trim() || "admin",
  adminPassword: required("ADMIN_PASSWORD"),
  commandPrefix: process.env.COMMAND_PREFIX?.trim() || "",
  dbPath: process.env.DB_PATH?.trim() || "./data/stream-bot.sqlite",
  ytdlpPath: defaultYtdlpPath,
  twitchClientId: process.env.TWITCH_CLIENT_ID?.trim() || "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET?.trim() || "",
  pollIntervalMs: positiveInt("POLL_INTERVAL_SECONDS", 30) * 1000
};
