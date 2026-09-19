import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { migrate } from "./migrations.js";
import { HealthServer } from "./health.js";
import { logger } from "./logger.js";
import { ModuleRegistry } from "./module-registry.js";
import { TemporaryVoice } from "./modules/temporary-voice.js";
import { createDiscordClient, registerCommands, wireDiscordEvents } from "./discord/bot.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const health = new HealthServer();
  const database = new Database(config.databaseUrl);
  const moduleSettings = new ModuleSettingsRepository(database);

  await health.start(config.healthHost, config.healthPort);

  try {
    await database.ping();
    await migrate(database);
    health.set({ database: "ready" });
  } catch (error) {
    health.set({ database: "down", status: "degraded", lastError: "database startup failed" });
    logger.error("Database startup failed", { error: String(error) });
    throw error;
  }

  const client = createDiscordClient();
  const temporaryVoice = new TemporaryVoice(database, () => client.guilds.cache.values());

  const modules = new ModuleRegistry();
  modules.register(temporaryVoice);

  for (const name of modules.list()) health.setModule(name, "starting");

  wireDiscordEvents(client, database, temporaryVoice, (status) => {
    health.set({ discord: status });
    if (status === "ready") health.set({ status: "ready" });
    else health.set({ status: "degraded" });
  });

  await modules.initAll();
  for (const name of modules.list()) health.setModule(name, "ready");

  await registerCommands(config, client);
  await client.login(config.discordToken);

  const shutdown = async (signal: string) => {
    logger.info("Shutdown requested", { signal });
    await modules.shutdownAll();
    client.destroy();
    await management.stop();
    await database.close();
    await health.stop();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: String(reason) });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: error.message });
    process.exitCode = 1;
  });
}

main().catch((error) => {
  logger.error("Fatal startup error", { error: String(error) });
  process.exitCode = 1;
});
