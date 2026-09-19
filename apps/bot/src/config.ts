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
  backupDirectory: string;
  nodeEnv: "development" | "test" | "production";
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  return {
    discordToken: required("DISCORD_TOKEN"),
    discordClientId: required("DISCORD_CLIENT_ID"),
    botIdentityId: process.env.BOT_IDENTITY_ID ?? "primary",
    ...(process.env.DISCORD_TEST_GUILD_ID ? { discordTestGuildId: process.env.DISCORD_TEST_GUILD_ID } : {}),
    healthHost: process.env.HEALTH_HOST ?? "127.0.0.1",
    healthPort: port("HEALTH_PORT", 3001),
    managementApiHost: process.env.MANAGEMENT_API_HOST ?? "127.0.0.1",
    managementApiPort: port("MANAGEMENT_API_PORT", 3002),
    managementApiKey: required("MANAGEMENT_API_KEY"),
    databaseUrl: required("DATABASE_URL"),
    lavalinkHost: process.env.LAVALINK_HOST ?? "127.0.0.1",
    lavalinkPort: port("LAVALINK_PORT", 2333),
    lavalinkPassword: required("LAVALINK_PASSWORD"),
    backupDirectory: process.env.BACKUP_DIRECTORY ?? "./data/backups",
    nodeEnv
  };
}
