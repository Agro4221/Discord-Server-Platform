import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { migrate } from "./migrations.js";
import { HealthServer } from "./health.js";
import { logger } from "./logger.js";
import { ModuleRegistry } from "./module-registry.js";
import { TemporaryVoice } from "./modules/temporary-voice.js";
import { Moderation } from "./modules/moderation.js";
import { AutoMod } from "./modules/automod.js";
import { Welcome } from "./modules/welcome.js";
import { Leveling } from "./modules/leveling.js";
import { Tickets } from "./modules/tickets.js";
import { RolePanels } from "./modules/role-panels.js";
import { Giveaways } from "./modules/giveaways.js";
import { Economy } from "./modules/economy.js";
import { Reminders } from "./modules/reminders.js";
import { Starboard } from "./modules/starboard.js";
import { AutomationEngine } from "./modules/automation-engine.js";
import { Security } from "./modules/security.js";
import { Notifications } from "./modules/notifications.js";
import { Verification } from "./modules/verification.js";
import { Analytics } from "./modules/analytics.js";
import { Music } from "./modules/music.js";
import { createDiscordClient, registerCommands, routeCommand, wireDiscordEvents } from "./discord/bot.js";
import { ConnectionSupervisor } from "./discord/connection-supervisor.js";
import { ManagementApiServer } from "./management-api.js";
import { DashboardSettingsService } from "./dashboard-settings.js";
import { ModuleSettingsRepository } from "./module-settings.js";
import { AuditLog } from "./audit.js";
import { PlatformEventBus } from "./events.js";
import { BotIdentityRepository } from "./bot-identity.js";
import { ConfigTransferService } from "./config-transfer.js";
import { BackupService } from "./backup.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const health = new HealthServer();
  const database = new Database(config.databaseUrl);
  const moduleSettings = new ModuleSettingsRepository(database);
  const auditLog = new AuditLog(database);
  const dashboardSettings = new DashboardSettingsService(database);
  const identities = new BotIdentityRepository(database);
  const transfer = new ConfigTransferService(database);
  const backups = new BackupService(database, config.backupDirectory);
  const events = new PlatformEventBus();

  await health.start(config.healthHost, config.healthPort);

  try {
    await database.ping();
    await migrate(database);
    await identities.ensureIdentity(config.botIdentityId, config.discordClientId);
    health.set({ database: "ready" });
  } catch (error) {
    health.set({ database: "down", status: "degraded", lastError: "database startup failed" });
    logger.error("Database startup failed", { error: String(error) });
    await health.stop().catch(() => undefined);
    await database.close().catch(() => undefined);
    throw error;
  }

  const client = createDiscordClient();
  const temporaryVoice = new TemporaryVoice(database, () => client.guilds.cache.values());
  const moderation = new Moderation(database);
  const autoMod = new AutoMod(database);
  const welcome = new Welcome(database);
  const leveling = new Leveling(database);
  const tickets = new Tickets(database);
  const rolePanels = new RolePanels(database);
  const giveaways = new Giveaways(database);
  const economy = new Economy(database);
  const reminders = new Reminders(database);
  const starboard = new Starboard(database);
  const automation = new AutomationEngine(database);
  const security = new Security(database);
  const notifications = new Notifications(database);
  const verification = new Verification(database);
  const analytics = new Analytics(database);
  const music = new Music(database, config);

  const modules = new ModuleRegistry({
    client,
    db: database,
    auditLog,
    events
  });

  modules.register(temporaryVoice);
  modules.register(moderation);
  modules.register(autoMod);
  modules.register(welcome);
  modules.register(leveling);
  modules.register(tickets);
  modules.register(rolePanels);
  modules.register(giveaways);
  modules.register(economy);
  modules.register(reminders);
  modules.register(starboard);
  modules.register(automation);
  modules.register(security);
  modules.register(notifications);
  modules.register(verification);
  modules.register(analytics);
  modules.register(music);

  for (const name of modules.list()) health.setModule(name, "starting");

  const supervisor = new ConnectionSupervisor(client, (status) => {
    health.set({
      discord: status,
      status: status === "ready" ? "ready" : "degraded"
    });
  });
  supervisor.start();

  const moduleStatus = await modules.initAll();
  for (const [name, status] of Object.entries(moduleStatus)) {
    health.setModule(name, status);
  }

  const management = new ManagementApiServer({
    host: config.managementApiHost,
    port: config.managementApiPort,
    apiKey: config.managementApiKey,
    client,
    moduleSettings,
    auditLog,
    settings: dashboardSettings,
    transfer,
    backups,
    rolePanels: {
      list: async (guildId) => rolePanels.list(guildId),
      create: async (guildId, input, callbacks) =>
        rolePanels.createPanel(guildId, input.channelId, input.roles, input.title, callbacks),
      update: async (guildId, panelId, input, callbacks) => rolePanels.updatePanel(guildId, panelId, input.channelId, input.roles, input.title ?? "Выберите роли", callbacks),
      delete: async (guildId, panelId, deleteMessage) => rolePanels.deletePanel(guildId, panelId, deleteMessage)
    },
    actions: {
      "temporary-voice.reconcile": async (guildId) => { await temporaryVoice.reconcileGuild(guildId); return { guildId, ok: true }; },
      "automation.reload": async (guildId) => { await automation.reload(); return { guildId, ok: true }; },
      "security.check-hierarchy": async (guildId) => security.checkHierarchy(guildId)
    }
  });
  await management.start();

  await registerCommands(config, client);
  wireDiscordEvents(client, events);

  events.on("interaction.command", (interaction) => {
    void routeCommand(client, interaction, database, temporaryVoice, moderation);
  });

  await client.login(config.discordToken);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Shutdown requested", { signal });
    supervisor.stop();
    await modules.shutdownAll();
    client.destroy();
    await management.stop().catch(() => undefined);
    await database.close().catch(() => undefined);
    await health.stop().catch(() => undefined);
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
