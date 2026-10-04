import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { migrate } from "./migrations.js";
import { HealthServer } from "./health.js";
import { logger } from "./logger.js";
import { ModuleRegistry } from "./module-registry.js";
import { TemporaryVoice } from "./modules/temporary-voice.js";
import { Moderation } from "./modules/moderation.js";
import { ModerationPresets } from "./modules/moderation-presets.js";
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
import { StreamAlerts } from "./modules/stream-alerts.js";
import { Verification } from "./modules/verification.js";
import { Onboarding } from "./modules/onboarding.js";
import { Analytics } from "./modules/analytics.js";
import { Music } from "./modules/music.js";
import { createDiscordClient, registerCommands, routeCommand, wireDiscordEvents } from "./discord/bot.js";
import { PrefixCommandRouter } from "./discord/prefix-commands.js";
import { ConnectionSupervisor } from "./discord/connection-supervisor.js";
import { ManagementApiServer } from "./management-api.js";
import { DashboardSettingsService } from "./dashboard-settings.js";
import { ModuleSettingsRepository } from "./module-settings.js";
import { AuditLog } from "./audit.js";
import { PlatformEventBus } from "./events.js";
import { BotIdentityRepository } from "./bot-identity.js";
import { ConfigTransferService } from "./config-transfer.js";
import { ServerConfigPresetService } from "./config-presets.js";
import { IntegrationCredentialRepository } from "./integration-credentials.js";
import { BackupService } from "./backup.js";
import { CustomCommandService } from "./custom-commands.js";
import { AutoResponder } from "./modules/autoresponder.js";
import { CommandPolicyService } from "./command-policy.js";
import { Polls } from "./modules/polls.js";
import { Reputation } from "./modules/reputation.js";
import { Birthdays } from "./modules/birthdays.js";
import { InviteTracking } from "./modules/invite-tracking.js";
import { HelpPages } from "./help-pages.js";
import { Forms } from "./modules/forms.js";

async function applyBotProfile(client: import("discord.js").Client, input: {
  username?: string;
  avatarData?: string | null;
  bannerData?: string | null;
}): Promise<void> {
  if (!client.user) return;

  const edit: {
    username?: string;
    avatar?: string | null;
    banner?: string | null;
  } = {};

  if (input.username !== undefined && input.username !== client.user.username) {
    edit.username = input.username;
  }
  if (input.avatarData !== undefined) {
    edit.avatar = input.avatarData;
  }
  if (input.bannerData !== undefined) {
    edit.banner = input.bannerData;
  }

  if (Object.keys(edit).length > 0) {
    await client.user.edit(edit);
  }
}

let fatalCleanup: (() => Promise<void>) | undefined;

async function main(): Promise<void> {
  const config = loadConfig();
  const health = new HealthServer();
  const database = new Database(config.databaseUrl);
  const moduleSettings = new ModuleSettingsRepository(database);
  const auditLog = new AuditLog(database);
  const dashboardSettings = new DashboardSettingsService(database);
  const identities = new BotIdentityRepository(database, config.botIdentityId, config.managementApiKey);
  const transfer = new ConfigTransferService(database);
  const configPresets = new ServerConfigPresetService(database);
  const integrationCredentials = new IntegrationCredentialRepository(database, config.managementApiKey);
  const backups = new BackupService(
    database,
    config.backupDirectory,
    config.backupRetentionCount,
    config.backupS3
  );

  let supervisor: ConnectionSupervisor | undefined;
  let management: ManagementApiServer | undefined;
  let fleetTimer: NodeJS.Timeout | undefined;
  let cleanupStarted = false;
  let modulesHealthy = true;
  let storedCredentials: Awaited<ReturnType<BotIdentityRepository["credentials"]>> = null;
  let runtimeConfig = config;
  let botEnabled = true;
  await health.start(config.healthHost, config.healthPort);

  try {
    await database.ping();
    await migrate(database);
    storedCredentials = await identities.credentials();
    const discordClientId = storedCredentials?.clientId || config.discordClientId;
    const discordToken = storedCredentials?.token || config.discordToken;
    botEnabled = storedCredentials?.enabled ?? true;
    if (discordClientId) {
      await identities.ensureIdentity(config.botIdentityId, discordClientId, storedCredentials?.token ? undefined : discordToken || undefined);
    }
    await identities.refreshAssignments();

    runtimeConfig = {
      ...config,
      discordClientId,
      discordToken
    };

    health.set({ database: "ready" });
    if (discordClientId) {
      await identities.heartbeat("starting", 0).catch((error) => {
        logger.warn("Initial fleet heartbeat failed", {
          identityId: config.botIdentityId,
          error: String(error)
        });
      });
    }
  } catch (error) {
    health.set({ database: "down", status: "degraded", lastError: "database startup failed" });
    logger.error("Database startup failed", { error: String(error) });
    await health.stop().catch((cleanupError) => {
      logger.warn("Health server cleanup after database startup failure failed", { error: String(cleanupError) });
    });
    await database.close().catch((cleanupError) => {
      logger.error("Database cleanup after startup failure failed", { error: String(cleanupError) });
    });
    throw error;
  }

  const client = createDiscordClient();
  auditLog.setClient(client);
  const events = new PlatformEventBus((guildId) => identities.ownsGuild(guildId));
  const temporaryVoice = new TemporaryVoice(database, () => client.guilds.cache.values());
  const moderation = new Moderation(database);
  const autoMod = new AutoMod(database, moderation);
  const welcome = new Welcome(database, (guildId) => client.guilds.cache.get(guildId));
  const leveling = new Leveling(database);
  const tickets = new Tickets(database);
  const rolePanels = new RolePanels(database);
  const giveaways = new Giveaways(database);
  const economy = new Economy(database);
  const reminders = new Reminders(database);
  const starboard = new Starboard(database);
  const security = new Security(database);
  const notifications = new Notifications(database);
  const streamAlerts = new StreamAlerts(database, config.streamAlerts, integrationCredentials, auditLog);
  const verification = new Verification(database, (guildId) => client.guilds.cache.get(guildId));
  const onboarding = new Onboarding(database);
  const analytics = new Analytics(database);
  const music = new Music(database, runtimeConfig, identities);
  const moderationPresets = new ModerationPresets(database, autoMod, security, moderation);
  const automation = new AutomationEngine(database, moderation, {
    tickets,
    giveaways,
    notifications,
    music
  });
  const customCommands = new CustomCommandService(database, runtimeConfig);
  const autoResponder = new AutoResponder(database);
  const commandPolicy = new CommandPolicyService(database);
  const polls = new Polls(database);
  const reputation = new Reputation(database);
  const birthdays = new Birthdays(database);
  const inviteTracking = new InviteTracking(database);
  const forms = new Forms(database);
  const helpPages = new HelpPages(database);

  const setModuleHealth = (
    name: string,
    status: import("./module.js").ModuleHealthStatus
  ): void => {
    health.setModule(name, status);
  };

  const modules = new ModuleRegistry({
    client,
    db: database,
    auditLog,
    events,
    identityId: config.botIdentityId,
    setModuleHealth
  });

  fatalCleanup = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;

    supervisor?.stop();
    if (fleetTimer) clearInterval(fleetTimer);

    if (runtimeConfig.discordClientId) {
      await identities.heartbeat("stopped", client.guilds.cache.size).catch((error) => {
        logger.warn("Stopped fleet heartbeat failed", {
          identityId: config.botIdentityId,
          error: String(error)
        });
      });
    }

    await modules.shutdownAll();
    await commandPolicy.shutdown();
    client.destroy();

    await management?.stop().catch((error) => {
      logger.warn("Management API shutdown failed", { error: String(error) });
    });
    await database.close().catch((error) => {
      logger.error("Database shutdown failed", { error: String(error) });
    });
    await health.stop().catch((error) => {
      logger.warn("Health server shutdown failed", { error: String(error) });
    });

    fatalCleanup = undefined;
  };

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
  modules.register(streamAlerts);
  modules.register(verification);
  modules.register(onboarding);
  modules.register(analytics);
  modules.register(music);
  modules.register(customCommands);
  modules.register(autoResponder);
  modules.register(polls);
  modules.register(reputation);
  modules.register(birthdays);
  modules.register(inviteTracking);
  modules.register(forms);

  for (const name of modules.list()) health.setModule(name, "starting");

  const connectDiscord = async (credentials: {
    clientId: string;
    token: string;
    enabled: boolean;
    presenceName?: string | null;
  }): Promise<void> => {
    if (!credentials.enabled) {
      client.destroy();
      botEnabled = false;
      health.set({ discord: "down", status: "degraded" });
      await identities.heartbeat("stopped", client.guilds.cache.size);
      logger.info("Discord bot disabled from Control Center", { identityId: config.botIdentityId });
      return;
    }
    if (!credentials.clientId || !credentials.token) throw new Error("bot_credentials_incomplete");

    if (client.isReady()) client.destroy();

    const nextConfig = {
      ...runtimeConfig,
      discordClientId: credentials.clientId,
      discordToken: credentials.token
    };
    await registerCommands(nextConfig, client);
    await client.login(credentials.token);
    runtimeConfig = nextConfig;
    botEnabled = true;
    if (credentials.presenceName && client.user) {
      client.user.setPresence({
        status: "online",
        activities: [{ name: credentials.presenceName }]
      });
    }
    logger.info("Discord bot connected from Control Center", {
      identityId: config.botIdentityId,
      clientId: credentials.clientId
    });
  };

  supervisor = new ConnectionSupervisor(client, (status) => {
    health.set({
      discord: status,
      status: status === "ready" && modulesHealthy ? "ready" : "degraded"
    });
    if (runtimeConfig.discordClientId) {
      void identities.heartbeat(status === "ready" ? "ready" : "degraded", client.guilds.cache.size).catch((error) => {
        logger.warn("Fleet heartbeat update failed", {
          identityId: config.botIdentityId,
          status,
          guildCount: client.guilds.cache.size,
          error: String(error)
        });
      });
    }
  });
  supervisor.start();

  const moduleStatus = await modules.initAll();
  modulesHealthy = Object.values(moduleStatus).every((status) => status === "ready");
  for (const [name, status] of Object.entries(moduleStatus)) {
    health.setModule(name, status);
  }

  if (!modulesHealthy) {
    health.set({
      status: "degraded",
      lastError: "one or more modules failed initialization"
    });
    logger.warn("Platform started with degraded modules", {
      modules: Object.entries(moduleStatus)
        .filter(([, status]) => status !== "ready")
        .map(([name]) => name)
    });
  }

  management = new ManagementApiServer({
    host: config.managementApiHost,
    port: config.managementApiPort,
    apiKey: config.managementApiKey,
    client,
    guildAccess: (guildId: string) =>
      config.botIdentityId === "primary"
        ? client.guilds.cache.has(guildId)
        : identities.ownsGuild(guildId),
    identities,
    botSetup: {
      get: async () => ({
        ...(await identities.settings()),
        username: client.user?.username ?? null,
        avatarUrl: client.user?.displayAvatarURL({ size: 256 }) ?? null,
        bannerUrl: client.user?.bannerURL({ size: 512 }) ?? null
      }),
      update: async (input: {
        clientId: string;
        token?: string;
        enabled?: boolean;
        presenceName?: string | null;
        username?: string;
        avatarData?: string | null;
        bannerData?: string | null;
      }) => {
        const saved = await identities.saveSettings(input);
        const credentials = await identities.credentials();
        try {
          if (saved.enabled) {
            if (!credentials?.token || !credentials.clientId) throw new Error("bot_credentials_incomplete");
            await connectDiscord({
              clientId: credentials.clientId,
              token: credentials.token,
              enabled: saved.enabled,
              presenceName: saved.presenceName
            });
            await applyBotProfile(client, input);
          } else {
            await connectDiscord({
              clientId: saved.clientId,
              token: credentials?.token ?? "",
              enabled: false,
              presenceName: saved.presenceName
            });
          }
        } catch (error) {
          await auditLog.record({
            source: "dashboard",
            action: "bot.credentials.connection_failed",
            targetType: "bot-identity",
            targetId: saved.id,
            metadata: {
              clientId: saved.clientId,
              enabled: saved.enabled,
              tokenConfigured: saved.tokenConfigured,
              error: String(error)
            }
          }).catch((auditError) => logger.warn("Bot credential failure audit delivery failed", { error: String(auditError) }));
          logger.error("Discord bot reconnect after credential update failed", {
            identityId: saved.id,
            clientId: saved.clientId,
            error: String(error)
          });
          throw error;
        }
        return saved;
      },
    },
    moduleSettings,
    auditLog,
    settings: dashboardSettings,
    transfer,
    presets: configPresets,
    integrationCredentials,
    backups,
    customCommands,
    autoResponder,
    forms,
    onboarding: {
      get: async (guildId) => onboarding.get(guildId),
      set: async (guildId, input) => onboarding.configure(guildId, input),
      validate: async (guildId) => onboarding.validate(guildId)
    },
    helpPages: {
      list: async (guildId) => helpPages.list(guildId),
      save: async (guildId, slug, title, content, enabled) => helpPages.save(guildId, slug, title, content, enabled),
      delete: async (guildId, slug) => helpPages.delete(guildId, slug)
    },
    tickets: {
      listPanels: async (guildId) => tickets.listPanels(guildId),
      createPanel: async (guildId, input) => tickets.createPanel(guildId, input),
      updatePanel: async (guildId, panelId, input) => tickets.updatePanel(guildId, panelId, input),
      deletePanel: async (guildId, panelId) => tickets.deletePanel(guildId, panelId),
      getFormFields: async (guildId) => tickets.getFormFields(guildId),
      setFormFields: async (guildId, fields) => tickets.setFormFields(guildId, fields),
      getCustomization: async (guildId) => tickets.getCustomization(guildId),
      setCustomization: async (guildId, customization) => tickets.setCustomization(guildId, customization),
      listTickets: async (guildId, status) => tickets.listTickets(guildId, status),
      updateTicketMetadata: async (guildId, ticketId, input) => tickets.updateTicketMetadata(guildId, ticketId, input),
      getSlaConfig: async (guildId) => tickets.getSlaConfig(guildId),
      setSlaConfig: async (guildId, input) => tickets.setSlaConfig(guildId, input)
    },
    moderation,
    moderationPresets: {
      list: async (guildId) => moderationPresets.list(guildId),
      saveCurrent: async (guildId, name) => moderationPresets.saveCurrent(guildId, name),
      apply: async (guildId, name) => moderationPresets.apply(guildId, name),
      delete: async (guildId, name) => moderationPresets.delete(guildId, name)
    },
    music,
    leveling,
    autoMod,
    commandPolicy,
    giveaways: {
      list: async (guildId) => giveaways.list(guildId),
      end: async (guildId, giveawayId) => giveaways.endGiveaway(giveawayId, guildId),
      reroll: async (guildId, giveawayId) => giveaways.rerollGiveaway(giveawayId, guildId)
    },
    community: {
      overview: async (guildId) => ({
        reputation: await reputation.dashboardLeaderboard(guildId, 8),
        leveling: await leveling.leaderboard(guildId, 8),
        giveaways: (await giveaways.list(guildId))
          .filter((item) => item.status === "running")
          .slice(0, 5)
          .map((item) => ({
            id: item.id,
            prize: item.prize,
            winners: item.winners,
            endsAt: item.endsAt
          })),
        polls: await polls.dashboardOpenPolls(guildId, 8)
      })
    },
    analytics: {
      report: async (guildId, hours) => analytics.report(guildId, hours),
      getSettings: async (guildId) => analytics.getSettings(guildId),
      setSettings: async (guildId, input) => analytics.setSettings(guildId, {
        retentionDays: typeof input.retentionDays === "number" ? input.retentionDays : undefined,
        visibleCounters: Array.isArray(input.visibleCounters) ? input.visibleCounters.filter((value): value is import("./modules/analytics.js").AnalyticsSettings["visibleCounters"][number] =>
          ["message","member_join","member_leave","voice_join","voice_leave","voice_move"].includes(String(value))
        ) as import("./modules/analytics.js").AnalyticsSettings["visibleCounters"] : undefined
      })
    },
    notifications: {
      list: async (guildId) => notifications.listFeeds(guildId),
      createSocial: async (guildId, provider, target, channelId, intervalSeconds, options) =>
        notifications.addSocialFeed(guildId, provider, target, channelId, intervalSeconds, options),
      create: async (guildId, channelId, url, intervalSeconds, options) =>
        notifications.addFeed(guildId, channelId, url, intervalSeconds, options),
      update: async (guildId, feedId, input) => notifications.updateFeed(guildId, feedId, input),
      delete: async (guildId, feedId) => notifications.deleteFeed(guildId, feedId)
    },
    streamAlerts: {
      list: async (guildId) => streamAlerts.list(guildId),
      providers: async (guildId) => streamAlerts.providers(guildId),
      create: async (guildId, input) => streamAlerts.create(guildId, input),
      update: async (guildId, alertId, input) => streamAlerts.update(guildId, alertId, input),
      delete: async (guildId, alertId) => streamAlerts.delete(guildId, alertId)
    },
    automation: {
      list: async (guildId) => automation.listRules(guildId),
      diagnostics: async (guildId) => automation.diagnostics(guildId),
      dryRun: async (input) => automation.dryRun({
        guildId: input.guildId,
        event: input.event as import("@dsp/domain").AutomationEvent,
        conditions: input.conditions as import("@dsp/domain").AutomationCondition[],
        anyConditions: input.anyConditions as import("@dsp/domain").AutomationCondition[],
        actions: input.actions as import("@dsp/domain").AutomationAction[],
        content: input.content,
        userId: input.userId,
        channelId: input.channelId,
        roleIds: input.roleIds
      }),
      create: async (guildId, input) => automation.createRule(
        guildId,
        input.name,
        input.event as import("@dsp/domain").AutomationEvent,
        input.conditions as import("@dsp/domain").AutomationCondition[],
        input.actions as import("@dsp/domain").AutomationAction[],
        input.cooldownSeconds,
        input.anyConditions as import("@dsp/domain").AutomationCondition[]
      ),
      update: async (guildId, ruleId, input) => automation.updateRule(
        guildId,
        ruleId,
        {
          name: input.name,
          event: input.event as import("@dsp/domain").AutomationEvent,
          conditions: input.conditions as import("@dsp/domain").AutomationCondition[],
          anyConditions: input.anyConditions as import("@dsp/domain").AutomationCondition[],
          actions: input.actions as import("@dsp/domain").AutomationAction[],
          cooldownSeconds: input.cooldownSeconds,
          enabled: input.enabled
        }
      ),
      delete: async (guildId, ruleId) => automation.deleteRule(guildId, ruleId),
      listTemplates: async (guildId) => automation.listTemplates(guildId),
      setTemplate: async (guildId, name, content) => automation.setTemplate(guildId, name, content),
      deleteTemplate: async (guildId, name) => automation.deleteTemplate(guildId, name),
      listPresets: async (guildId) => automation.listPresets(guildId),
      savePreset: async (guildId, name, event, conditions, anyConditions, actions, cooldownSeconds) =>
        automation.savePreset(
          guildId,
          name,
          event as import("@dsp/domain").AutomationEvent,
          conditions as import("@dsp/domain").AutomationCondition[],
          anyConditions as import("@dsp/domain").AutomationCondition[],
          actions as import("@dsp/domain").AutomationAction[],
          cooldownSeconds
        ),
      deletePreset: async (guildId, name) => automation.deletePreset(guildId, name)
    },
    rolePanels: {
      list: async (guildId) => rolePanels.list(guildId),
      create: async (guildId, input, callbacks) =>
        rolePanels.createPanel(guildId, input.channelId, input.roles, input.title, input.selectionMode, input.maxSelections, input.durationMinutes ?? 0, callbacks, input.componentType ?? "buttons"),
      update: async (guildId, panelId, input, callbacks) =>
        rolePanels.updatePanel(guildId, panelId, input.channelId, input.roles, input.title ?? "Выберите роли", input.selectionMode, input.maxSelections, input.durationMinutes ?? 0, callbacks, input.componentType ?? "buttons"),
      delete: async (guildId, panelId, deleteMessage) => rolePanels.deletePanel(guildId, panelId, deleteMessage),
      listAutomationRules: async (guildId) => rolePanels.listAutomationRules(guildId),
      saveAutomationRule: async (guildId, input) => rolePanels.saveAutomationRule(guildId, input),
      deleteAutomationRule: async (guildId, id) => rolePanels.deleteAutomationRule(guildId, id)
    },
    actions: {
      "temporary-voice.reconcile": async (guildId) => { await temporaryVoice.reconcileGuild(guildId); return { guildId, ok: true }; },
      "welcome.preview": async (guildId) => welcome.sendPreview(guildId),
      "verification.publish-panel": async (guildId) => verification.publishPanel(guildId),
      "automation.reload": async (guildId) => { await automation.reload(); return { guildId, ok: true }; },
      "security.check-hierarchy": async (guildId) => security.checkHierarchy(guildId)
    }
  });
  await management.start();

  wireDiscordEvents(client, events);
  client.once("ready", () => temporaryVoice.markReady());

  await identities.claimUnassignedGuilds([...client.guilds.cache.keys()]);
  await identities.refreshAssignments();

  fleetTimer = setInterval(() => {
    void identities.refreshAssignments()
      .then(() => runtimeConfig.discordClientId
        ? identities.heartbeat(
          botEnabled ? (modulesHealthy ? "ready" : "degraded") : "stopped",
          client.guilds.cache.size
        )
        : undefined)
      .catch((error) => logger.warn("Fleet heartbeat failed", {
        identityId: config.botIdentityId,
        error: String(error)
      }));
  }, 15_000);
  fleetTimer.unref();

  events.on("interaction.command", (interaction) => {
    void routeCommand(client, interaction, database, temporaryVoice, moderation, helpPages);
  });

  events.addCommandGuard((interaction) => commandPolicy.checkInteraction(interaction));

  const prefixCommands = new PrefixCommandRouter(
    database,
    leveling,
    moderation,
    music,
    customCommands,
    commandPolicy,
    economy,
    reminders,
    tickets,
    rolePanels,
    giveaways
  );
  events.on("message.create", (message) => {
    void prefixCommands.handleMessage(message);
  });

  if (botEnabled && runtimeConfig.discordClientId && runtimeConfig.discordToken) {
    await connectDiscord({
      clientId: runtimeConfig.discordClientId,
      token: runtimeConfig.discordToken,
      enabled: true,
      presenceName: storedCredentials?.presenceName
    });
  } else {
    health.set({ discord: "down", status: "degraded", lastError: "Discord bot credentials are not configured" });
    logger.warn("Discord bot is not configured; Control Center remains available for registration", {
      identityId: config.botIdentityId
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Shutdown requested", { signal });
    await fatalCleanup?.();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection; restarting process through controlled shutdown", {
      reason: String(reason)
    });
    void fatalCleanup?.().finally(() => process.exit(1));
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception; restarting process through controlled shutdown", {
      error: error.message,
      stack: error.stack
    });
    void fatalCleanup?.().finally(() => process.exit(1));
  });
}

main().catch(async (error) => {
  logger.error("Fatal startup error", { error: String(error) });
  try {
    await fatalCleanup?.();
  } catch (cleanupError) {
    logger.error("Fatal startup cleanup failed", { error: String(cleanupError) });
  }
  process.exitCode = 1;
});
