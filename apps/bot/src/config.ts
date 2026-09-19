export type AppConfig = {
  discordToken: string;
  discordClientId: string;
  discordTestGuildId?: string;
  dashboardHost: string;
  dashboardPort: number;
  databaseUrl: string;
  nodeEnv: "development" | "test" | "production";
  tempVoicePrefix: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid integer environment variable: ${name}`);
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
    ...(process.env.DISCORD_TEST_GUILD_ID ? { discordTestGuildId: process.env.DISCORD_TEST_GUILD_ID } : {}),
    dashboardHost: process.env.DASHBOARD_HOST ?? "127.0.0.1",
    dashboardPort: integer("DASHBOARD_PORT", 3001),
    databaseUrl: required("DATABASE_URL"),
    nodeEnv,
    tempVoicePrefix: process.env.TEMP_VOICE_PREFIX ?? "DSP • "
  };
}
