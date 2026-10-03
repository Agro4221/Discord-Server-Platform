import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { EmbedBuilder, type Client } from "discord.js";
import { logger } from "./logger.js";
import { ModuleSettingsRepository } from "./module-settings.js";
import { MODULE_CATALOG, type ModuleKey } from "./modules/catalog.js";
import { AuditLog } from "./audit.js";
import { DashboardSettingsService, moduleExists } from "./dashboard-settings.js";
import { guildResources } from "./discord/resources.js";
import { ConfigTransferService } from "./config-transfer.js";
import { BackupService } from "./backup.js";
import type { CustomCommandService } from "./custom-commands.js";
import type { AutoResponder, AutoResponderInput } from "./modules/autoresponder.js";
import type { TicketCustomization, TicketFormField } from "./modules/tickets.js";
import type { Moderation } from "./modules/moderation.js";
import type { Music } from "./modules/music.js";
import type { Leveling } from "./modules/leveling.js";
import type { Economy } from "./modules/economy.js";
import type { AutoMod } from "./modules/automod.js";
import { CommandPolicyService, COMMAND_DEFINITIONS } from "./command-policy.js";
import type { StreamAlertPlatform } from "./modules/stream-alerts.js";
import { BotIdentityRepository } from "./bot-identity.js";

type ApiOptions = {
  host: string;
  port: number;
  apiKey: string;
  client: Client;
  moduleSettings: ModuleSettingsRepository;
  auditLog: AuditLog;
  settings: DashboardSettingsService;
  transfer: ConfigTransferService;
  backups: BackupService;
  identities?: BotIdentityRepository;
  guildAccess?: (guildId: string) => boolean;
  actions: Record<string, (guildId: string) => Promise<unknown>>;
  giveaways?: {
    list: (guildId: string) => Promise<unknown[]>;
    end: (guildId: string, giveawayId: number) => Promise<unknown>;
    reroll: (guildId: string, giveawayId: number) => Promise<unknown>;
  };
  analytics?: {
    report: (guildId: string, hours?: number) => Promise<unknown>;
  };
  notifications?: {
    list: (guildId: string) => Promise<unknown[]>;
    create: (guildId: string, channelId: string, url: string, intervalSeconds: number) => Promise<unknown>;
    update: (guildId: string, feedId: number, input: { channelId?: string; url?: string; intervalSeconds?: number; enabled?: boolean; messageTemplate?: string }) => Promise<boolean>;
    delete: (guildId: string, feedId: number) => Promise<boolean>;
  };
  streamAlerts?: {
    list: (guildId: string) => Promise<unknown[]>;
    providers: () => unknown;
    create: (guildId: string, input: {
      platform: StreamAlertPlatform;
      target: string;
      channelId: string;
      mentionRoleId?: string | null;
      intervalSeconds: number;
      enabled?: boolean;
      messageTemplate?: string;
    }) => Promise<unknown>;
    update: (guildId: string, alertId: number, input: {
      target?: string;
      channelId?: string;
      mentionRoleId?: string | null;
      intervalSeconds?: number;
      enabled?: boolean;
      messageTemplate?: string;
    }) => Promise<boolean>;
    delete: (guildId: string, alertId: number) => Promise<boolean>;
  };
  automation?: {
    list: (guildId: string) => Promise<unknown[]>;
    diagnostics: (guildId: string) => Promise<unknown>;
    dryRun: (input: {
      guildId: string;
      event: string;
      conditions: unknown[];
      anyConditions: unknown[];
      actions: unknown[];
      content?: string;
      userId?: string;
      channelId?: string;
      roleIds?: string[];
      numeric?: Record<string, number>;
    }) => Promise<unknown>;
    create: (guildId: string, input: {
      name: string;
      event: string;
      conditions: unknown[];
      anyConditions: unknown[];
      actions: unknown[];
      cooldownSeconds: number;
    }) => Promise<unknown>;
    update: (guildId: string, ruleId: string, input: {
      name: string;
      event: string;
      conditions: unknown[];
      anyConditions: unknown[];
      actions: unknown[];
      cooldownSeconds: number;
      enabled?: boolean;
    }) => Promise<boolean>;
    delete: (guildId: string, ruleId: string) => Promise<boolean>;
    listTemplates: (guildId: string) => Promise<unknown[]>;
    setTemplate: (guildId: string, name: string, content: string) => Promise<void>;
    deleteTemplate: (guildId: string, name: string) => Promise<boolean>;
  };
  customCommands?: CustomCommandService;
  autoResponder?: AutoResponder;
  tickets?: {
    getFormFields: (guildId: string) => Promise<TicketFormField[]>;
    setFormFields: (guildId: string, fields: TicketFormField[]) => Promise<TicketFormField[]>;
    getCustomization: (guildId: string) => Promise<TicketCustomization>;
    setCustomization: (guildId: string, customization: Partial<TicketCustomization>) => Promise<TicketCustomization>;
  };
  moderation?: Moderation;
  music?: Music;
  leveling?: Leveling;
  economy?: Economy;
  autoMod?: AutoMod;
  commandPolicy?: CommandPolicyService;
  rolePanels?: {
    list: (guildId: string) => Promise<unknown[]>;
    create: (
      guildId: string,
      input: { channelId: string; title?: string; roles: Array<{ roleId: string; label: string }>; selectionMode?: "toggle" | "exclusive" | "max"; maxSelections?: number; durationMinutes?: number },
      callbacks: {
        deleteMessage: (channelId: string, messageId: string) => Promise<void>;
        sendMessage: (channelId: string, content: string, components: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[]) => Promise<string>;
      }
    ) => Promise<unknown>;
    update: (
      guildId: string,
      panelId: number,
      input: { channelId: string; title?: string; roles: Array<{ roleId: string; label: string }>; selectionMode?: "toggle" | "exclusive" | "max"; maxSelections?: number; durationMinutes?: number },
      callbacks: {
        editMessage: (channelId: string, messageId: string, content: string, components: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[]) => Promise<void>;
        deleteMessage: (channelId: string, messageId: string) => Promise<void>;
        sendMessage: (channelId: string, content: string, components: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[]) => Promise<string>;
      }
    ) => Promise<unknown>;
    delete: (guildId: string, panelId: number, deleteMessage: (channelId: string, messageId: string) => Promise<void>) => Promise<boolean>;
  };
};

type RateWindow = { startedAt: number; count: number };

export class ManagementApiServer {
  private server?: Server;
  private readonly rateWindows = new Map<string, RateWindow>();
  private rateCleanupTimer?: NodeJS.Timeout;

  constructor(private readonly options: ApiOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.rateCleanupTimer = setInterval(() => this.cleanupRateWindows(), 60_000);
      this.rateCleanupTimer.unref();

      this.server = createServer(async (req, res) => {
        const requestStartedAt = Date.now();
        const requestMethod = req.method ?? "GET";
        const requestPath = req.url ?? "/";
        const ip = req.socket.remoteAddress ?? "unknown";

        req.setTimeout(15_000, () => {
          if (res.writableEnded) return;
          logger.warn("Management API request timed out", {
            method: requestMethod,
            path: requestPath,
            ip
          });
          res.writeHead(408, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "request_timeout" }));
          req.destroy();
        });

        try {
          if (!this.allowedRate(ip)) {
            this.json(res, 429, { error: "rate_limited" });
            return;
          }

          if (!this.authorized(req.headers.authorization)) {
            this.json(res, 401, { error: "unauthorized" });
            return;
          }

          const method = requestMethod;
          const url = new URL(requestPath, `http://${this.options.host}:${this.options.port}`);
          const path = url.pathname;

          const scopedGuild = path.match(/^\/api\/guilds\/([^/]+)/);
          if (scopedGuild && this.options.guildAccess && !this.options.guildAccess(scopedGuild[1] ?? "")) {
            this.json(res, 404, { error: "guild_not_found" });
            return;
          }

          if (method === "GET" && path === "/api/fleet") {
            if (!this.options.identities) {
              this.json(res, 500, { error: "fleet_unavailable" });
              return;
            }
            this.json(res, 200, { identities: await this.options.identities.listFleet() });
            return;
          }

          if (method === "POST" && path === "/api/fleet/assign") {
            if (!this.options.identities) {
              this.json(res, 500, { error: "fleet_unavailable" });
              return;
            }
            const body = await readJson(req);
            if (typeof body.guildId !== "string" || !/^\d{17,20}$/.test(body.guildId) ||
                typeof body.botIdentityId !== "string" || body.botIdentityId.length < 1 || body.botIdentityId.length > 100) {
              throw new RequestInputError("invalid_fleet_assignment", 400);
            }
            const identities = await this.options.identities.list();
            const identity = identities.find((item) => item.id === body.botIdentityId);
            if (!identity || !identity.enabled) {
              throw new RequestInputError("bot_identity_not_available", 400);
            }

            const guild = this.options.client.guilds.cache.get(body.guildId);
            const botMember = guild
              ? await guild.members.fetch(identity.clientId).catch(() => null)
              : null;
            if (!botMember?.user.bot) {
              throw new RequestInputError("bot_identity_not_in_guild", 400);
            }

            await this.options.identities.assignGuild(body.guildId, body.botIdentityId);
            await this.options.auditLog.record({
              guildId: body.guildId,
              source: "dashboard",
              action: "fleet.guild.assigned",
              targetType: "bot-identity",
              targetId: body.botIdentityId
            });
            this.json(res, 200, { ok: true, guildId: body.guildId, botIdentityId: body.botIdentityId });
            return;
          }

          const musicBotsMatch = path.match(/^\/api\/guilds\/([^/]+)\/music-bots$/);
          const musicBotAssignMatch = path.match(/^\/api\/guilds\/([^/]+)\/music-bots\/assign$/);
          const musicBotItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/music-bots\/([^/]+)$/);

          if ((musicBotsMatch || musicBotAssignMatch || musicBotItemMatch) && !this.options.identities) {
            this.json(res, 500, { error: "fleet_unavailable" });
            return;
          }

          if (method === "GET" && musicBotsMatch) {
            const guildId = musicBotsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }

            this.json(res, 200, {
              guildId,
              assignments: await this.options.identities!.listMusicAssignments(guildId)
            });
            return;
          }

          if (method === "POST" && musicBotAssignMatch) {
            const guildId = musicBotAssignMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }

            const body = await readJson(req);
            if (
              typeof body.botIdentityId !== "string" ||
              body.botIdentityId.length < 1 ||
              body.botIdentityId.length > 100 ||
              typeof body.voiceChannelId !== "string" ||
              !/^\d{17,20}$/.test(body.voiceChannelId)
            ) {
              throw new RequestInputError("invalid_music_assignment", 400);
            }

            const channel = this.options.client.guilds.cache.get(guildId)?.channels.cache.get(body.voiceChannelId);
            if (!channel || (channel.type !== 2 && channel.type !== 13)) {
              throw new RequestInputError("voice_channel_required", 400);
            }

            const identities = await this.options.identities!.list();
            const identity = identities.find((item) => item.id === body.botIdentityId);
            if (!identity || !identity.enabled) throw new RequestInputError("bot_identity_not_available", 400);

            const botMember = await this.options.client.guilds.cache.get(guildId)?.members.fetch(identity.clientId).catch(() => null);
            if (!botMember?.user.bot) throw new RequestInputError("bot_identity_not_in_guild", 400);

            await this.options.identities!.assignMusicVoice(guildId, body.botIdentityId, body.voiceChannelId);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "fleet.music.voice.assigned",
              targetType: "bot-identity",
              targetId: body.botIdentityId,
              metadata: { voiceChannelId: body.voiceChannelId }
            });
            this.json(res, 200, {
              ok: true,
              guildId,
              botIdentityId: body.botIdentityId,
              voiceChannelId: body.voiceChannelId
            });
            return;
          }

          if (method === "DELETE" && musicBotItemMatch) {
            const guildId = musicBotItemMatch[1] ?? "";
            const botIdentityId = musicBotItemMatch[2] ?? "";
            if (!guildId || !botIdentityId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_music_bot_not_found" });
              return;
            }

            const removed = await this.options.identities!.unassignMusicVoice(guildId, botIdentityId);
            if (!removed) {
              this.json(res, 404, { error: "music_assignment_not_found" });
              return;
            }

            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "fleet.music.voice.unassigned",
              targetType: "bot-identity",
              targetId: botIdentityId
            });
            this.json(res, 200, { ok: true, guildId, botIdentityId });
            return;
          }

          if (method === "GET" && path === "/api/guilds") {
            const guilds = [...this.options.client.guilds.cache.values()]
              .filter((guild) => !this.options.guildAccess || this.options.guildAccess(guild.id))
              .map((guild) => ({
              id: guild.id,
              name: guild.name,
              icon: guild.iconURL({ size: 64 }),
              memberCount: guild.memberCount,
              channelCount: guild.channels.cache.size,
              roleCount: Math.max(0, guild.roles.cache.size - 1)
            }));
            this.json(res, 200, { guilds });
            return;
          }

          const modulesMatch = path.match(/^\/api\/guilds\/([^/]+)\/modules$/);
          if (method === "GET" && modulesMatch) {
            const guildId = modulesMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }

            const modules = await this.options.moduleSettings.list(guildId);
            this.json(res, 200, { guildId, catalog: MODULE_CATALOG, modules });
            return;
          }

          const actionMatch = path.match(/^\/api\/guilds\/([^/]+)\/actions\/([^/]+)\/([^/]+)$/);
          if (method === "POST" && actionMatch) {
            const guildId = actionMatch[1];
            const actionKey = (actionMatch[2] ?? "") + "." + (actionMatch[3] ?? "");
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }

            const handler = this.options.actions[actionKey];
            if (!handler) {
              this.json(res, 400, { error: "unknown_action" });
              return;
            }

            const result = await handler(guildId);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "module.action",
              targetType: "action",
              targetId: actionKey
            });
            this.json(res, 200, { ok: true, result });
            return;
          }

          const exportMatch = path.match(/^\/api\/guilds\/([^/]+)\/export$/);
          if (method === "GET" && exportMatch) {
            const guildId = exportMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const payload = await this.options.transfer.exportGuild(guildId);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "config.exported",
              targetType: "guild",
              targetId: guildId
            });
            this.json(res, 200, payload);
            return;
          }

          const importMatch = path.match(/^\/api\/guilds\/([^/]+)\/import$/);
          if (method === "POST" && importMatch) {
            const guildId = importMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            if (!body.payload) {
              this.json(res, 400, { error: "payload_required" });
              return;
            }
            await this.options.transfer.importGuild(guildId, body.payload);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "config.imported",
              targetType: "guild",
              targetId: guildId
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const backupMatch = path.match(/^\/api\/guilds\/([^/]+)\/backup$/);
          if (method === "POST" && backupMatch) {
            const guildId = backupMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const file = await this.options.backups.createGuildBackup(guildId);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "backup.created",
              targetType: "backup",
              targetId: file
            });
            this.json(res, 200, { ok: true, file: file.split("/").pop() ?? file });
            return;
          }

          const backupsMatch = path.match(/^\/api\/guilds\/([^/]+)\/backups$/);
          const restoreBackupMatch = path.match(/^\/api\/guilds\/([^/]+)\/backups\/([^/]+)\/restore$/);
          const deleteBackupMatch = path.match(/^\/api\/guilds\/([^/]+)\/backups\/([^/]+)$/);

          if (method === "GET" && backupsMatch) {
            const guildId = backupsMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const backups = await this.options.backups.listBackups(guildId);
            this.json(res, 200, { guildId, backups });
            return;
          }

          if (method === "POST" && restoreBackupMatch) {
            const guildId = restoreBackupMatch[1];
            const file = restoreBackupMatch[2];
            if (!guildId || !file || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_backup_not_found" });
              return;
            }
            await this.options.backups.restoreGuildBackup(guildId, file);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "backup.restored",
              targetType: "backup",
              targetId: file
            });
            this.json(res, 200, { ok: true, guildId, file });
            return;
          }

          if (method === "DELETE" && deleteBackupMatch) {
            const guildId = deleteBackupMatch[1];
            const file = deleteBackupMatch[2];
            if (!guildId || !file || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_backup_not_found" });
              return;
            }
            await this.options.backups.deleteBackup(file, guildId);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "backup.deleted",
              targetType: "backup",
              targetId: file
            });
            this.json(res, 200, { ok: true, guildId, file });
            return;
          }

          const giveawaysMatch = path.match(/^\/api\/guilds\/([^/]+)\/giveaways$/);
          const giveawayActionMatch = path.match(/^\/api\/guilds\/([^/]+)\/giveaways\/(\d+)\/(end|reroll)$/);

          if ((giveawaysMatch || giveawayActionMatch) && !this.options.giveaways) {
            this.json(res, 500, { error: "giveaways_unavailable" });
            return;
          }

          if (method === "GET" && giveawaysMatch) {
            const guildId = giveawaysMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, giveaways: await this.options.giveaways!.list(guildId) });
            return;
          }

          if (method === "POST" && giveawayActionMatch) {
            const guildId = giveawayActionMatch[1] ?? "";
            const giveawayId = Number(giveawayActionMatch[2]);
            const action = giveawayActionMatch[3];
            if (!guildId || !Number.isSafeInteger(giveawayId) || !action || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_giveaway_not_found" });
              return;
            }

            const result = action === "end"
              ? await this.options.giveaways!.end(guildId, giveawayId)
              : await this.options.giveaways!.reroll(guildId, giveawayId);

            if (result === null) {
              this.json(res, 404, { error: "giveaway_not_found_or_not_actionable" });
              return;
            }

            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "giveaway." + action,
              targetType: "giveaway",
              targetId: String(giveawayId)
            });
            this.json(res, 200, { ok: true, result });
            return;
          }

          const feedsMatch = path.match(/^\/api\/guilds\/([^/]+)\/feeds$/);
          const feedItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/feeds\/(\\d+)$/);

          if ((feedsMatch || feedItemMatch) && !this.options.notifications) {
            this.json(res, 500, { error: "notifications_unavailable" });
            return;
          }

          if (method === "GET" && feedsMatch) {
            const guildId = feedsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, feeds: await this.options.notifications!.list(guildId) });
            return;
          }

          if ((method === "POST" && feedsMatch) || (method === "PUT" && feedItemMatch)) {
            const guildId = feedsMatch?.[1] ?? feedItemMatch?.[1] ?? "";
            const feedId = feedItemMatch ? Number(feedItemMatch[2]) : null;
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || (feedId !== null && !Number.isSafeInteger(feedId))) {
              this.json(res, 404, { error: "guild_or_feed_not_found" });
              return;
            }
            const body = await readJson(req);

            if (feedId === null) {
              if (typeof body.channelId !== "string" || !/^\\d{17,20}$/.test(body.channelId) ||
                  typeof body.url !== "string" || body.url.length > 2000 ||
                  typeof body.intervalSeconds !== "number" || !Number.isFinite(body.intervalSeconds)) {
                throw new RequestInputError("invalid_feed", 400);
              }
              const channel = this.options.client.guilds.cache.get(guildId)?.channels.cache.get(body.channelId);
              if (!channel || channel.type !== 0) throw new RequestInputError("text_channel_required", 400);
              const result = await this.options.notifications!.create(guildId, body.channelId, body.url, Math.trunc(body.intervalSeconds));
              await this.options.auditLog.record({ guildId, source: "dashboard", action: "feed.created", targetType: "feed", targetId: String((result as { id?: number })?.id ?? "unknown") });
              this.json(res, 200, { ok: true, feed: result });
              return;
            }

            const input: { channelId?: string; url?: string; intervalSeconds?: number; enabled?: boolean; messageTemplate?: string } = {};
            if (typeof body.channelId === "string") input.channelId = body.channelId;
            if (typeof body.url === "string") input.url = body.url;
            if (typeof body.intervalSeconds === "number") input.intervalSeconds = body.intervalSeconds;
            if (typeof body.enabled === "boolean") input.enabled = body.enabled;
            if (typeof body.messageTemplate === "string") input.messageTemplate = body.messageTemplate.slice(0, 1000);

            if (input.channelId !== undefined) {
              const channel = this.options.client.guilds.cache.get(guildId)?.channels.cache.get(input.channelId);
              if (!channel || channel.type !== 0) throw new RequestInputError("text_channel_required", 400);
            }
            if (input.url !== undefined && (typeof input.url !== "string" || input.url.length > 2000)) throw new RequestInputError("invalid_feed_url", 400);
            if (input.intervalSeconds !== undefined && (typeof input.intervalSeconds !== "number" || !Number.isFinite(input.intervalSeconds))) throw new RequestInputError("invalid_interval", 400);
            if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new RequestInputError("invalid_enabled", 400);

            const updated = await this.options.notifications!.update(guildId, feedId, input);
            if (!updated) {
              this.json(res, 404, { error: "feed_not_found" });
              return;
            }
            await this.options.auditLog.record({ guildId, source: "dashboard", action: "feed.updated", targetType: "feed", targetId: String(feedId) });
            this.json(res, 200, { ok: true });
            return;
          }

          if (method === "DELETE" && feedItemMatch) {
            const guildId = feedItemMatch[1] ?? "";
            const feedId = Number(feedItemMatch[2]);
            if (!guildId || !Number.isSafeInteger(feedId) || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_feed_not_found" });
              return;
            }
            const deleted = await this.options.notifications!.delete(guildId, feedId);
            if (!deleted) {
              this.json(res, 404, { error: "feed_not_found" });
              return;
            }
            await this.options.auditLog.record({ guildId, source: "dashboard", action: "feed.deleted", targetType: "feed", targetId: String(feedId) });
            this.json(res, 200, { ok: true });
            return;
          }

          const streamAlertsMatch = path.match(/^\/api\/guilds\/([^/]+)\/stream-alerts$/);
          const streamAlertItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/stream-alerts\/(\\d+)$/);

          if ((streamAlertsMatch || streamAlertItemMatch) && !this.options.streamAlerts) {
            this.json(res, 500, { error: "stream_alerts_unavailable" });
            return;
          }

          if (method === "GET" && streamAlertsMatch) {
            const guildId = streamAlertsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, providers: this.options.streamAlerts!.providers(), alerts: await this.options.streamAlerts!.list(guildId) });
            return;
          }

          if (method === "POST" && streamAlertsMatch) {
            const guildId = streamAlertsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const platform = typeof body.platform === "string" ? body.platform : "";
            const target = typeof body.target === "string" ? body.target.trim() : "";
            const channelId = typeof body.channelId === "string" ? body.channelId : "";
            const mentionRoleId = body.mentionRoleId == null ? null : typeof body.mentionRoleId === "string" ? body.mentionRoleId : "";
            const messageTemplate = typeof body.messageTemplate === "string" ? body.messageTemplate.slice(0, 1000) : undefined;
            const intervalSeconds = Number(body.intervalSeconds);
            if (!["twitch","youtube","vk","kick"].includes(platform) || !target || target.length > 200 || !/^\d{17,20}$/.test(channelId) || (mentionRoleId && !/^\d{17,20}$/.test(mentionRoleId)) || !Number.isFinite(intervalSeconds)) {
              throw new RequestInputError("invalid_stream_alert", 400);
            }
            const guild = this.options.client.guilds.cache.get(guildId);
            const channel = guild?.channels.cache.get(channelId);
            if (!channel || channel.type !== 0) throw new RequestInputError("text_channel_required", 400);
            if (mentionRoleId && !guild?.roles.cache.has(mentionRoleId)) throw new RequestInputError("role_not_found", 400);
            const created = await this.options.streamAlerts!.create(guildId, {
              platform: platform as StreamAlertPlatform, target, channelId, mentionRoleId,
              intervalSeconds: Math.trunc(intervalSeconds), enabled: body.enabled !== false, messageTemplate
            });
            await this.options.auditLog.record({ guildId, source: "dashboard", action: "stream-alert.created", targetType: "stream-alert", targetId: String((created as { id?: number }).id ?? "unknown") });
            this.json(res, 200, { ok: true, alert: created });
            return;
          }

          if (method === "PUT" && streamAlertItemMatch) {
            const guildId = streamAlertItemMatch[1] ?? "";
            const alertId = Number(streamAlertItemMatch[2]);
            if (!guildId || !Number.isSafeInteger(alertId) || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_stream_alert_not_found" });
              return;
            }
            const body = await readJson(req);
            const input: { target?: string; channelId?: string; mentionRoleId?: string | null; intervalSeconds?: number; enabled?: boolean; messageTemplate?: string } = {};
            if (typeof body.target === "string") input.target = body.target.trim();
            if (typeof body.channelId === "string") input.channelId = body.channelId;
            if (body.mentionRoleId === null) input.mentionRoleId = null;
            else if (typeof body.mentionRoleId === "string") input.mentionRoleId = body.mentionRoleId;
            if (typeof body.intervalSeconds === "number") input.intervalSeconds = Math.trunc(body.intervalSeconds);
            if (typeof body.enabled === "boolean") input.enabled = body.enabled;
            const guild = this.options.client.guilds.cache.get(guildId);
            if (input.channelId) {
              const channel = guild?.channels.cache.get(input.channelId);
              if (!channel || channel.type !== 0) throw new RequestInputError("text_channel_required", 400);
            }
            if (input.mentionRoleId && !guild?.roles.cache.has(input.mentionRoleId)) throw new RequestInputError("role_not_found", 400);
            const updated = await this.options.streamAlerts!.update(guildId, alertId, input);
            if (!updated) {
              this.json(res, 404, { error: "stream_alert_not_found" });
              return;
            }
            await this.options.auditLog.record({ guildId, source: "dashboard", action: "stream-alert.updated", targetType: "stream-alert", targetId: String(alertId) });
            this.json(res, 200, { ok: true });
            return;
          }

          if (method === "DELETE" && streamAlertItemMatch) {
            const guildId = streamAlertItemMatch[1] ?? "";
            const alertId = Number(streamAlertItemMatch[2]);
            if (!guildId || !Number.isSafeInteger(alertId) || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_stream_alert_not_found" });
              return;
            }
            const deleted = await this.options.streamAlerts!.delete(guildId, alertId);
            if (!deleted) {
              this.json(res, 404, { error: "stream_alert_not_found" });
              return;
            }
            await this.options.auditLog.record({ guildId, source: "dashboard", action: "stream-alert.deleted", targetType: "stream-alert", targetId: String(alertId) });
            this.json(res, 200, { ok: true });
            return;
          }

          const analyticsMatch = path.match(/^\/api\/guilds\/([^/]+)\/analytics$/);
          if (method === "GET" && analyticsMatch) {
            if (!this.options.analytics) {
              this.json(res, 500, { error: "analytics_unavailable" });
              return;
            }
            const guildId = analyticsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const hours = Number.parseInt(url.searchParams.get("hours") ?? "24", 10);
            if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
              this.json(res, 400, { error: "invalid_hours" });
              return;
            }
            this.json(res, 200, { guildId, report: await this.options.analytics.report(guildId, hours) });
            return;
          }

          const automationMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation$/);
          const automationDryRunMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation\/dry-run$/);
          const automationDiagnosticsMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation\/diagnostics$/);
          const automationItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation\/([^/]+)$/);

          if ((automationMatch || automationDryRunMatch || automationDiagnosticsMatch || automationItemMatch) && !this.options.automation) {
            this.json(res, 500, { error: "automation_unavailable" });
            return;
          }

          if (method === "GET" && automationDiagnosticsMatch) {
            const guildId = automationDiagnosticsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, {
              guildId,
              diagnostics: await this.options.automation!.diagnostics(guildId)
            });
            return;
          }

          if (method === "GET" && automationMatch) {
            const guildId = automationMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, rules: await this.options.automation!.list(guildId) });
            return;
          }

          if (method === "POST" && automationDryRunMatch) {
            const guildId = automationDryRunMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const event = typeof body.event === "string" ? body.event : "";
            const conditions = body.conditions;
            const anyConditions = body.anyConditions ?? [];
            const actions = body.actions;
            const cooldownSeconds = typeof body.cooldownSeconds === "number" ? body.cooldownSeconds : 0;
            if (
              typeof event !== "string" || event.length > 64 ||
              !Array.isArray(conditions) || conditions.length > 10 ||
              !Array.isArray(anyConditions) || anyConditions.length > 10 ||
              conditions.length + anyConditions.length > 10 ||
              !Array.isArray(actions) || actions.length < 1 || actions.length > 10 ||
              !Number.isFinite(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86400
            ) {
              throw new RequestInputError("invalid_automation_rule", 400);
            }
            validateAutomationPayload(this.options.client, guildId, event, [...conditions, ...anyConditions], actions);
            const result = await this.options.automation!.dryRun({
              guildId,
              event,
              conditions,
              anyConditions,
              actions,
              content: typeof body.content === "string" ? body.content.slice(0, 2000) : "",
              userId: typeof body.userId === "string" ? body.userId : undefined,
              channelId: typeof body.channelId === "string" ? body.channelId : undefined,
              roleIds: Array.isArray(body.roleIds)
                ? body.roleIds.filter((v: unknown): v is string => typeof v === "string").slice(0, 20)
                : [],
              numeric: body.numeric && typeof body.numeric === "object" && !Array.isArray(body.numeric)
                ? Object.fromEntries(
                    Object.entries(body.numeric as Record<string, unknown>)
                      .filter(([key, value]) => [
                        "memberCount","messageLength","mentionCount","previousLength",
                        "caseId","ticketId","giveawayId","winnerCount","timestamp",
                        "minute","hour","dayOfWeek","dayOfMonth"
                      ].includes(key) && typeof value === "number" && Number.isFinite(value))
                      .slice(0, 20)
                  ) as Record<string, number>
                : {}
            });
            this.json(res, 200, { ok: true, result });
            return;
          }

          if ((method === "POST" && automationMatch) || (method === "PUT" && automationItemMatch)) {
            const guildId = automationMatch?.[1] ?? automationItemMatch?.[1] ?? "";
            const ruleId = automationItemMatch?.[2] ?? null;
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || (ruleId && ruleId.length > 128)) {
              this.json(res, 404, { error: "guild_or_rule_not_found" });
              return;
            }

            const body = await readJson(req);
            const name = body.name;
            const event = body.event;
            const conditions = body.conditions;
            const anyConditions = body.anyConditions ?? [];
            const actions = body.actions;
            const cooldownSeconds = body.cooldownSeconds;

            if (
              typeof name !== "string" || name.trim().length < 1 || name.length > 80 ||
              typeof event !== "string" || event.length > 64 ||
              !Array.isArray(conditions) || conditions.length > 10 ||
              !Array.isArray(anyConditions) || anyConditions.length > 10 ||
              conditions.length + anyConditions.length > 10 ||
              !Array.isArray(actions) || actions.length < 1 || actions.length > 10 ||
              typeof cooldownSeconds !== "number" || !Number.isFinite(cooldownSeconds) ||
              cooldownSeconds < 0 || cooldownSeconds > 86400
            ) {
              throw new RequestInputError("invalid_automation_rule", 400);
            }

            validateAutomationPayload(this.options.client, guildId, event, [...conditions, ...anyConditions], actions);

            const input = {
              name: name.trim(),
              event,
              conditions,
              anyConditions,
              actions,
              cooldownSeconds,
              ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {})
            };

            const result = ruleId === null
              ? await this.options.automation!.create(guildId, input)
              : await this.options.automation!.update(guildId, ruleId, input);

            if (ruleId !== null && result === false) {
              this.json(res, 404, { error: "rule_not_found" });
              return;
            }

            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: ruleId === null ? "automation.created" : "automation.updated",
              targetType: "automation-rule",
              targetId: ruleId ?? String((result as { id?: string })?.id ?? "unknown")
            });
            this.json(res, 200, { ok: true, rule: ruleId === null ? result : undefined });
            return;
          }

          if (method === "DELETE" && automationItemMatch) {
            const guildId = automationItemMatch[1] ?? "";
            const ruleId = automationItemMatch[2] ?? "";
            if (!guildId || !ruleId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_rule_not_found" });
              return;
            }
            const deleted = await this.options.automation!.delete(guildId, ruleId);
            if (!deleted) {
              this.json(res, 404, { error: "rule_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "automation.deleted",
              targetType: "automation-rule",
              targetId: ruleId
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const automationTemplatesMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation\/templates$/);
          const automationTemplateItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation\/templates\/([^/]+)$/);

          if ((automationTemplatesMatch || automationTemplateItemMatch) && !this.options.automation) {
            this.json(res, 500, { error: "automation_unavailable" });
            return;
          }

          if (method === "GET" && automationTemplatesMatch) {
            const guildId = automationTemplatesMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, templates: await this.options.automation!.listTemplates(guildId) });
            return;
          }

          if (method === "POST" && automationTemplatesMatch) {
            const guildId = automationTemplatesMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
            const content = typeof body.content === "string" ? body.content : "";
            if (!/^[a-z0-9_-]{1,40}$/.test(name) || !content.trim() || content.length > 2000) {
              throw new RequestInputError("invalid_automation_template", 400);
            }
            await this.options.automation!.setTemplate(guildId, name, content);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "automation.template.saved",
              targetType: "automation-template",
              targetId: name
            });
            this.json(res, 200, { ok: true });
            return;
          }

          if (method === "DELETE" && automationTemplateItemMatch) {
            const guildId = automationTemplateItemMatch[1] ?? "";
            const name = decodeURIComponent(automationTemplateItemMatch[2] ?? "").toLowerCase();
            if (!guildId || !/^[a-z0-9_-]{1,40}$/.test(name) || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_template_not_found" });
              return;
            }
            const deleted = await this.options.automation!.deleteTemplate(guildId, name);
            if (!deleted) {
              this.json(res, 404, { error: "template_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "automation.template.deleted",
              targetType: "automation-template",
              targetId: name
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const embedMatch = path.match(/^\/api\/guilds\/([^/]+)\/embed$/);
          if (method === "POST" && embedMatch) {
            const guildId = embedMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const channelId = typeof body.channelId === "string" ? body.channelId : "";
            const channel = this.options.client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
            if (!/^\d{17,20}$/.test(channelId) || channel?.type !== 0) {
              throw new RequestInputError("text_channel_required", 400);
            }
            const title = typeof body.title === "string" ? body.title.trim().slice(0,256) : "";
            const description = typeof body.description === "string" ? body.description.slice(0,4096) : "";
            const footer = typeof body.footer === "string" ? body.footer.slice(0,2048) : "";
            const url = typeof body.url === "string" ? body.url.trim() : "";
            const image = typeof body.image === "string" ? body.image.trim() : "";
            const thumbnail = typeof body.thumbnail === "string" ? body.thumbnail.trim() : "";
            const color = typeof body.color === "string" ? body.color.trim() : "";
            if (!title && !description && !footer && !image && !thumbnail) {
              throw new RequestInputError("embed_content_required", 400);
            }
            for (const value of [url,image,thumbnail]) {
              if (value && !/^https?:\/\//i.test(value)) throw new RequestInputError("embed_url_must_be_http", 400);
            }
            if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
              throw new RequestInputError("embed_color_invalid", 400);
            }
            const embed = new EmbedBuilder();
            if (title) embed.setTitle(title);
            if (description) embed.setDescription(description);
            if (url) embed.setURL(url);
            if (color) embed.setColor(parseInt(color.slice(1),16));
            if (footer) embed.setFooter({ text: footer });
            if (image) embed.setImage(image);
            if (thumbnail) embed.setThumbnail(thumbnail);
            await channel.send({ embeds: [embed] });
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "embed.published",
              targetType: "channel",
              targetId: channelId
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const commandPoliciesMatch = path.match(/^\/api\/guilds\/([^/]+)\/command-policies$/);
          const commandPolicyItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/command-policies\/([^/]+)$/);

          if ((commandPoliciesMatch || commandPolicyItemMatch) && !this.options.commandPolicy) {
            this.json(res, 500, { error: "command_policy_unavailable" });
            return;
          }

          if (method === "GET" && commandPoliciesMatch) {
            const guildId = commandPoliciesMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, {
              guildId,
              definitions: COMMAND_DEFINITIONS,
              policies: await this.options.commandPolicy!.list(guildId)
            });
            return;
          }

          if (method === "PUT" && commandPolicyItemMatch) {
            const guildId = commandPolicyItemMatch[1] ?? "";
            const commandName = decodeURIComponent(commandPolicyItemMatch[2] ?? "");
            if (!guildId || !commandName || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_command_not_found" });
              return;
            }
            const body = await readJson(req);
            await this.options.commandPolicy!.set(guildId, commandName, {
              enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
              prefixEnabled: typeof body.prefixEnabled === "boolean" ? body.prefixEnabled : undefined,
              slashEnabled: typeof body.slashEnabled === "boolean" ? body.slashEnabled : undefined,
              cooldownSeconds: body.cooldownSeconds === undefined ? undefined : Number(body.cooldownSeconds),
              allowedRoleIds: Array.isArray(body.allowedRoleIds) ? body.allowedRoleIds.filter((v: unknown): v is string => typeof v === "string") : undefined,
              deniedRoleIds: Array.isArray(body.deniedRoleIds) ? body.deniedRoleIds.filter((v: unknown): v is string => typeof v === "string") : undefined,
              allowedChannelIds: Array.isArray(body.allowedChannelIds) ? body.allowedChannelIds.filter((v: unknown): v is string => typeof v === "string") : undefined,
              deniedChannelIds: Array.isArray(body.deniedChannelIds) ? body.deniedChannelIds.filter((v: unknown): v is string => typeof v === "string") : undefined,
              helpVisible: typeof body.helpVisible === "boolean" ? body.helpVisible : undefined
            });
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "command-policy.updated",
              targetType: "command",
              targetId: commandName
            });
            this.json(res, 200, { ok: true, policy: await this.options.commandPolicy!.get(guildId, commandName) });
            return;
          }

          const automodRulesMatch = path.match(/^\/api\/guilds\/([^/]+)\/automod\/rules$/);
          const automodRuleItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/automod\/rules\/(\d+)$/);

          if ((automodRulesMatch || automodRuleItemMatch) && !this.options.autoMod) {
            this.json(res, 500, { error: "automod_unavailable" });
            return;
          }

          if (method === "GET" && automodRulesMatch) {
            const guildId = automodRulesMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, rules: await this.options.autoMod!.listRules(guildId) });
            return;
          }

          if (method === "POST" && automodRulesMatch) {
            const guildId = automodRulesMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const detector = typeof body.detector === "string" ? body.detector : "";
            const action = typeof body.action === "string" ? body.action : "delete";
            if (!detector || !["delete","timeout","warn","log"].includes(action)) {
              throw new RequestInputError("invalid_automod_rule", 400);
            }
            await this.options.autoMod!.upsertRule(guildId, {
              detector,
              enabled: body.enabled !== false,
              threshold: body.threshold === null || body.threshold === undefined ? null : Number(body.threshold),
              windowSeconds: body.windowSeconds === null || body.windowSeconds === undefined ? null : Number(body.windowSeconds),
              action: action as "delete" | "timeout" | "warn" | "log",
              timeoutMinutes: body.timeoutMinutes === undefined ? 0 : Number(body.timeoutMinutes),
              affectedRoleIds: Array.isArray(body.affectedRoleIds) ? body.affectedRoleIds.filter((v: unknown): v is string => typeof v === "string") : [],
              ignoredRoleIds: Array.isArray(body.ignoredRoleIds) ? body.ignoredRoleIds.filter((v: unknown): v is string => typeof v === "string") : [],
              affectedChannelIds: Array.isArray(body.affectedChannelIds) ? body.affectedChannelIds.filter((v: unknown): v is string => typeof v === "string") : [],
              ignoredChannelIds: Array.isArray(body.ignoredChannelIds) ? body.ignoredChannelIds.filter((v: unknown): v is string => typeof v === "string") : [],
              ignoreModerators: body.ignoreModerators !== false,
              messageTemplate: typeof body.messageTemplate === "string" ? body.messageTemplate : ""
            });
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "automod.rule.updated",
              targetType: "automod-rule",
              targetId: detector
            });
            this.json(res, 200, { ok: true, rules: await this.options.autoMod!.listRules(guildId) });
            return;
          }

          if (method === "DELETE" && automodRuleItemMatch) {
            const guildId = automodRuleItemMatch[1] ?? "";
            const id = Number(automodRuleItemMatch[2]);
            if (!guildId || !Number.isSafeInteger(id)) {
              this.json(res, 404, { error: "guild_or_rule_not_found" });
              return;
            }
            const deleted = await this.options.autoMod!.deleteRule(guildId, id);
            if (!deleted) {
              this.json(res, 404, { error: "automod_rule_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "automod.rule.deleted",
              targetType: "automod-rule",
              targetId: String(id)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const economyItemsMatch = path.match(/^\/api\/guilds\/([^/]+)\/economy\/items$/);
          const economyItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/economy\/items\/(\d+)$/);

          if ((economyItemsMatch || economyItemMatch) && !this.options.economy) {
            this.json(res, 500, { error: "economy_unavailable" });
            return;
          }

          if (method === "GET" && economyItemsMatch) {
            const guildId = economyItemsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, items: await this.options.economy!.dashboardItems(guildId) });
            return;
          }

          if ((method === "POST" || method === "PUT") && (economyItemsMatch || economyItemMatch)) {
            const guildId = economyItemsMatch?.[1] ?? economyItemMatch?.[1] ?? "";
            const id = economyItemMatch ? Number(economyItemMatch[2]) : null;
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || (id !== null && !Number.isSafeInteger(id))) {
              this.json(res, 404, { error: "guild_or_shop_item_not_found" });
              return;
            }
            const body = await readJson(req);
            const input = {
              name: typeof body.name === "string" ? body.name : "",
              description: typeof body.description === "string" ? body.description : "",
              price: Number(body.price),
              roleId: body.roleId === null || typeof body.roleId === "string" ? body.roleId : null,
              stock: body.stock === null || body.stock === undefined ? null : Number(body.stock),
              ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {})
            };
            const result = id === null
              ? await this.options.economy!.createDashboardItem(guildId, input)
              : await this.options.economy!.updateDashboardItem(guildId, id, input);
            if (id !== null && !result) {
              this.json(res, 404, { error: "shop_item_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: id === null ? "economy.shop.created" : "economy.shop.updated",
              targetType: "shop-item",
              targetId: String(id ?? result)
            });
            this.json(res, 200, { ok: true, items: await this.options.economy!.dashboardItems(guildId) });
            return;
          }

          if (method === "DELETE" && economyItemMatch) {
            const guildId = economyItemMatch[1] ?? "";
            const id = Number(economyItemMatch[2]);
            if (!guildId || !Number.isSafeInteger(id)) {
              this.json(res, 404, { error: "guild_or_shop_item_not_found" });
              return;
            }
            const deleted = await this.options.economy!.deleteDashboardItem(guildId, id);
            if (!deleted) {
              this.json(res, 404, { error: "shop_item_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "economy.shop.deleted",
              targetType: "shop-item",
              targetId: String(id)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const levelingMatch = path.match(/^\/api\/guilds\/([^/]+)\/leveling$/);
          const levelingRewardsMatch = path.match(/^\/api\/guilds\/([^/]+)\/leveling\/rewards$/);
          const levelingRewardItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/leveling\/rewards\/(\d+)$/);
          const levelingExclusionsMatch = path.match(/^\/api\/guilds\/([^/]+)\/leveling\/exclusions$/);

          if ((levelingMatch || levelingRewardsMatch || levelingRewardItemMatch || levelingExclusionsMatch) && !this.options.leveling) {
            this.json(res, 500, { error: "leveling_unavailable" });
            return;
          }

          if (method === "GET" && levelingMatch) {
            const guildId = levelingMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, {
              guildId,
              rewards: await this.options.leveling!.listRewards(guildId),
              exclusions: await this.options.leveling!.listExclusions(guildId)
            });
            return;
          }

          if (method === "POST" && levelingRewardsMatch) {
            const guildId = levelingRewardsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const level = Number(body.level);
            const roleId = typeof body.roleId === "string" ? body.roleId : "";
            if (!Number.isInteger(level) || level < 1 || !/^\d{15,25}$/.test(roleId)) {
              throw new RequestInputError("invalid_level_reward", 400);
            }
            await this.options.leveling!.upsertReward(guildId, {
              level,
              roleId,
              removePrevious: body.removePrevious !== false,
              dmUser: body.dmUser === true,
              message: typeof body.message === "string" ? body.message : ""
            });
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "leveling.reward.upserted",
              targetType: "role",
              targetId: roleId,
              metadata: { level }
            });
            this.json(res, 200, { ok: true, rewards: await this.options.leveling!.listRewards(guildId) });
            return;
          }

          if (method === "DELETE" && levelingRewardItemMatch) {
            const guildId = levelingRewardItemMatch[1] ?? "";
            const level = Number(levelingRewardItemMatch[2]);
            if (!guildId || !Number.isInteger(level)) {
              this.json(res, 404, { error: "guild_or_reward_not_found" });
              return;
            }
            const deleted = await this.options.leveling!.deleteReward(guildId, level);
            if (!deleted) {
              this.json(res, 404, { error: "level_reward_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "leveling.reward.deleted",
              targetType: "level-reward",
              targetId: String(level)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          if (method === "POST" && levelingExclusionsMatch) {
            const guildId = levelingExclusionsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const kind = body.kind;
            const refId = typeof body.refId === "string" ? body.refId : "";
            if ((kind !== "role" && kind !== "channel") || !/^\d{15,25}$/.test(refId) || typeof body.enabled !== "boolean") {
              throw new RequestInputError("invalid_leveling_exclusion", 400);
            }
            await this.options.leveling!.setExclusion(guildId, kind, refId, body.enabled);
            this.json(res, 200, { ok: true, exclusions: await this.options.leveling!.listExclusions(guildId) });
            return;
          }

          const membersMatch = path.match(/^\/api\/guilds\/([^/]+)\/members$/);
          if (method === "GET" && membersMatch) {
            const guildId = membersMatch[1] ?? "";
            const guild = guildId ? this.options.client.guilds.cache.get(guildId) : null;
            if (!guild) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const query = (url.searchParams.get("search") ?? "").trim().toLocaleLowerCase();
            const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
            const members = [...guild.members.cache.values()]
              .filter((member) => !member.user.bot)
              .filter((member) => !query || member.displayName.toLocaleLowerCase().includes(query) || member.user.username.toLocaleLowerCase().includes(query) || member.id.includes(query))
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
              .slice(0, limit)
              .map((member) => ({
                id: member.id,
                username: member.user.username,
                displayName: member.displayName,
                avatar: member.displayAvatarURL({ size: 64 }),
                manageable: member.manageable,
                bannable: member.bannable,
                moderatable: member.moderatable
              }));
            this.json(res, 200, { guildId, members });
            return;
          }

          const moderationMatch = path.match(/^\/api\/guilds\/([^/]+)\/moderation$/);
          if (method === "POST" && moderationMatch) {
            if (!this.options.moderation) {
              this.json(res, 500, { error: "moderation_unavailable" });
              return;
            }
            const guildId = moderationMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const moderationAction = body.action;
            if (typeof moderationAction !== "string" || !["warn","timeout","kick","ban","unban"].includes(moderationAction)) {
              throw new RequestInputError("invalid_moderation_action", 400);
            }
            const action = moderationAction as "warn" | "timeout" | "kick" | "ban" | "unban";
            const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : "";
            const reason = typeof body.reason === "string" ? body.reason.slice(0, 1000) : "";
            const durationMinutes = body.durationMinutes === undefined ? undefined : Number(body.durationMinutes);
            if (!/^\d{15,25}$/.test(targetUserId)) throw new RequestInputError("invalid_target_user", 400);
            if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 40320)) {
              throw new RequestInputError("invalid_duration", 400);
            }

            const result = await this.options.moderation.dashboardAction(
              guildId,
              targetUserId,
              action,
              reason,
              durationMinutes
            );
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "moderation.dashboard",
              targetType: "user",
              targetId: targetUserId,
              metadata: { moderationAction: action, ...(durationMinutes ? { durationMinutes } : {}), ...(reason ? { reason } : {}) }
            });
            this.json(res, 200, { ok: true, result });
            return;
          }

          const moderationEscalationsMatch = path.match(/^\/api\/guilds\/([^/]+)\/moderation\/escalations$/);
          const moderationEscalationItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/moderation\/escalations\/(\d+)$/);

          if ((moderationEscalationsMatch || moderationEscalationItemMatch) && !this.options.moderation) {
            this.json(res, 500, { error: "moderation_unavailable" });
            return;
          }

          if (method === "GET" && moderationEscalationsMatch) {
            const guildId = moderationEscalationsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, rules: await this.options.moderation!.listEscalations(guildId) });
            return;
          }

          if (method === "POST" && moderationEscalationsMatch) {
            const guildId = moderationEscalationsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const warnCount = Number(body.warnCount);
            const action = typeof body.action === "string" ? body.action : "";
            const durationMinutes = Number(body.durationMinutes ?? 0);
            const reason = typeof body.reason === "string" ? body.reason : "";
            if (!Number.isInteger(warnCount) || warnCount < 1 || warnCount > 100 ||
                !["timeout","ban"].includes(action) ||
                !Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 40320 ||
                !reason.trim()) {
              throw new RequestInputError("invalid_escalation", 400);
            }
            await this.options.moderation!.setEscalation(
              guildId, warnCount, action as "timeout" | "ban", durationMinutes, reason
            );
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "moderation.escalation.configured",
              targetType: "escalation",
              targetId: String(warnCount),
              metadata: { action, durationMinutes, reason: reason.trim().slice(0,500) }
            });
            this.json(res, 200, { ok: true });
            return;
          }

          if (method === "DELETE" && moderationEscalationItemMatch) {
            const guildId = moderationEscalationItemMatch[1] ?? "";
            const warnCount = Number(moderationEscalationItemMatch[2]);
            if (!guildId || !Number.isSafeInteger(warnCount) || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_or_escalation_not_found" });
              return;
            }
            const removed = await this.options.moderation!.removeEscalation(guildId, warnCount);
            if (!removed) {
              this.json(res, 404, { error: "escalation_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "moderation.escalation.removed",
              targetType: "escalation",
              targetId: String(warnCount)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const moderationHistoryMatch = path.match(/^\/api\/guilds\/([^/]+)\/moderation\/history$/);
          if (method === "GET" && moderationHistoryMatch) {
            if (!this.options.moderation) {
              this.json(res, 500, { error: "moderation_unavailable" });
              return;
            }
            const guildId = moderationHistoryMatch[1] ?? "";
            const userId = url.searchParams.get("userId") ?? "";
            if (!guildId || !/^\d{15,25}$/.test(userId) || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 400, { error: "invalid_moderation_history_query" });
              return;
            }
            this.json(res, 200, {
              guildId,
              userId,
              cases: await this.options.moderation.history(guildId, userId, 50)
            });
            return;
          }

          const ticketFormMatch = path.match(/^\/api\/guilds\/([^/]+)\/tickets\/form$/);
          if (ticketFormMatch && !this.options.tickets) {
            this.json(res, 500, { error: "tickets_unavailable" });
            return;
          }
          if (method === "GET" && ticketFormMatch) {
            const guildId = ticketFormMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, fields: await this.options.tickets!.getFormFields(guildId) });
            return;
          }
          if (method === "PUT" && ticketFormMatch) {
            const guildId = ticketFormMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            if (!Array.isArray(body.fields)) throw new RequestInputError("invalid_ticket_form", 400);
            const fields = await this.options.tickets!.setFormFields(guildId, body.fields as TicketFormField[]);
            await this.options.auditLog.record({
              guildId, source: "dashboard", action: "tickets.form.updated",
              targetType: "ticket-form", targetId: guildId,
              metadata: { fieldCount: fields.length, fieldIds: fields.map((field) => field.id) }
            });
            this.json(res, 200, { ok: true, guildId, fields });
            return;
          }

          const ticketCustomizationMatch = path.match(/^\/api\/guilds\/([^/]+)\/tickets\/customization$/);
          if (ticketCustomizationMatch && !this.options.tickets) {
            this.json(res, 500, { error: "tickets_unavailable" });
            return;
          }
          if (method === "GET" && ticketCustomizationMatch) {
            const guildId = ticketCustomizationMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, customization: await this.options.tickets!.getCustomization(guildId) });
            return;
          }
          if (method === "PUT" && ticketCustomizationMatch) {
            const guildId = ticketCustomizationMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const customization = await this.options.tickets!.setCustomization(guildId, {
              panelTitle: typeof body.panelTitle === "string" ? body.panelTitle : undefined,
              panelDescription: typeof body.panelDescription === "string" ? body.panelDescription : undefined,
              createButtonLabel: typeof body.createButtonLabel === "string" ? body.createButtonLabel : undefined,
              claimButtonLabel: typeof body.claimButtonLabel === "string" ? body.claimButtonLabel : undefined,
              closeButtonLabel: typeof body.closeButtonLabel === "string" ? body.closeButtonLabel : undefined
            });
            await this.options.auditLog.record({
              guildId, source: "dashboard", action: "tickets.customization.updated",
              targetType: "ticket-customization", targetId: guildId,
              metadata: { keys: Object.keys(body).filter((key) => ["panelTitle","panelDescription","createButtonLabel","claimButtonLabel","closeButtonLabel"].includes(key)) }
            });
            this.json(res, 200, { ok: true, guildId, customization });
            return;
          }

          const autoResponderMatch = path.match(/^\/api\/guilds\/([^/]+)\/autoresponder$/);
          const autoResponderItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/autoresponder\/(\d+)$/);

          if ((autoResponderMatch || autoResponderItemMatch) && !this.options.autoResponder) {
            this.json(res, 500, { error: "autoresponder_unavailable" });
            return;
          }

          if (method === "GET" && autoResponderMatch) {
            const guildId = autoResponderMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, rules: await this.options.autoResponder!.list(guildId) });
            return;
          }

          if ((method === "POST" || method === "PUT") && (autoResponderMatch || autoResponderItemMatch)) {
            const guildId = autoResponderMatch?.[1] ?? autoResponderItemMatch?.[1] ?? "";
            const id = autoResponderItemMatch ? Number(autoResponderItemMatch[2]) : null;
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || (id !== null && !Number.isSafeInteger(id))) {
              this.json(res, 404, { error: "guild_or_autoresponder_not_found" });
              return;
            }
            const body = await readJson(req);
            const input: AutoResponderInput = {
              trigger: typeof body.trigger === "string" ? body.trigger : "",
              matchType: typeof body.matchType === "string" ? body.matchType as AutoResponderInput["matchType"] : "contains",
              response: typeof body.response === "string" ? body.response : "",
              enabled: typeof body.enabled === "boolean" ? body.enabled : true,
              deleteTrigger: typeof body.deleteTrigger === "boolean" ? body.deleteTrigger : false,
              cooldownSeconds: typeof body.cooldownSeconds === "number" ? body.cooldownSeconds : 0,
              priority: typeof body.priority === "number" ? body.priority : 0,
              allowedRoleIds: Array.isArray(body.allowedRoleIds) ? body.allowedRoleIds.filter((v: unknown): v is string => typeof v === "string") : [],
              ignoredRoleIds: Array.isArray(body.ignoredRoleIds) ? body.ignoredRoleIds.filter((v: unknown): v is string => typeof v === "string") : [],
              allowedChannelIds: Array.isArray(body.allowedChannelIds) ? body.allowedChannelIds.filter((v: unknown): v is string => typeof v === "string") : [],
              ignoredChannelIds: Array.isArray(body.ignoredChannelIds) ? body.ignoredChannelIds.filter((v: unknown): v is string => typeof v === "string") : []
            };
            const result = id === null
              ? await this.options.autoResponder!.create(guildId, input)
              : await this.options.autoResponder!.update(guildId, id, input);
            if (id !== null && !result) {
              this.json(res, 404, { error: "autoresponder_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: id === null ? "autoresponder.created" : "autoresponder.updated",
              targetType: "autoresponder",
              targetId: String(id ?? (result as { id?: number })?.id ?? "unknown")
            });
            this.json(res, 200, { ok: true, rule: result });
            return;
          }

          if (method === "DELETE" && autoResponderItemMatch) {
            const guildId = autoResponderItemMatch[1] ?? "";
            const id = Number(autoResponderItemMatch[2]);
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || !Number.isSafeInteger(id)) {
              this.json(res, 404, { error: "guild_or_autoresponder_not_found" });
              return;
            }
            const deleted = await this.options.autoResponder!.delete(guildId, id);
            if (!deleted) {
              this.json(res, 404, { error: "autoresponder_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "autoresponder.deleted",
              targetType: "autoresponder",
              targetId: String(id)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const musicMatch = path.match(/^\/api\/guilds\/([^/]+)\/music$/);
          const musicControlMatch = path.match(/^\/api\/guilds\/([^/]+)\/music\/control$/);
          if ((musicMatch || musicControlMatch) && !this.options.music) {
            this.json(res, 500, { error: "music_unavailable" });
            return;
          }

          if (method === "GET" && musicMatch) {
            const guildId = musicMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, state: await this.options.music!.dashboardState(guildId) });
            return;
          }

          if (method === "POST" && musicControlMatch) {
            const guildId = musicControlMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const body = await readJson(req);
            const musicAction = body.action;
            if (typeof musicAction !== "string" || !["play","pause","resume","skip","stop","shuffle","repeat","seek","volume","autoplay"].includes(musicAction)) {
              throw new RequestInputError("invalid_music_action", 400);
            }
            const action = musicAction as "play" | "pause" | "resume" | "skip" | "stop" | "shuffle" | "repeat" | "seek" | "volume" | "autoplay";
            await this.options.music!.dashboardControl(guildId, action, {
              query: typeof body.query === "string" ? body.query : undefined,
              voiceChannelId: typeof body.voiceChannelId === "string" ? body.voiceChannelId : undefined,
              value: body.value === undefined ? undefined : Number(body.value),
              mode: typeof body.mode === "string" ? body.mode : undefined,
              enabled: typeof body.enabled === "boolean" ? body.enabled : undefined
            });
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "music.dashboard",
              targetType: "music",
              targetId: action
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const customCommandsMatch = path.match(/^\/api\/guilds\/([^/]+)\/custom-commands$/);
          const customCommandItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/custom-commands\/(\d+)$/);

          if ((customCommandsMatch || customCommandItemMatch) && !this.options.customCommands) {
            this.json(res, 500, { error: "custom_commands_unavailable" });
            return;
          }

          if (method === "GET" && customCommandsMatch) {
            const guildId = customCommandsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, commands: await this.options.customCommands!.list(guildId) });
            return;
          }

          if ((method === "POST" || method === "PUT") && (customCommandsMatch || customCommandItemMatch)) {
            const guildId = customCommandsMatch?.[1] ?? customCommandItemMatch?.[1] ?? "";
            const id = customCommandItemMatch ? Number(customCommandItemMatch[2]) : null;
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || (id !== null && !Number.isSafeInteger(id))) {
              this.json(res, 404, { error: "guild_or_custom_command_not_found" });
              return;
            }

            const body = await readJson(req);
            const input = {
              name: typeof body.name === "string" ? body.name : "",
              aliases: Array.isArray(body.aliases) ? body.aliases.filter((v: unknown): v is string => typeof v === "string") : [],
              description: typeof body.description === "string" ? body.description : "",
              enabled: typeof body.enabled === "boolean" ? body.enabled : true,
              prefixEnabled: typeof body.prefixEnabled === "boolean" ? body.prefixEnabled : true,
              slashEnabled: typeof body.slashEnabled === "boolean" ? body.slashEnabled : false,
              actionType:
                body.actionType === "alias" ? "alias" as const :
                body.actionType === "add_role" ? "add_role" as const :
                body.actionType === "remove_role" ? "remove_role" as const :
                body.actionType === "toggle_role" ? "toggle_role" as const :
                "response" as const,
              response: typeof body.response === "string" ? body.response : "",
              aliasTarget: typeof body.aliasTarget === "string" ? body.aliasTarget : null,
              allowedRoleIds: Array.isArray(body.allowedRoleIds) ? body.allowedRoleIds.filter((v: unknown): v is string => typeof v === "string") : [],
              allowedChannelIds: Array.isArray(body.allowedChannelIds) ? body.allowedChannelIds.filter((v: unknown): v is string => typeof v === "string") : [],
              cooldownSeconds: typeof body.cooldownSeconds === "number" ? body.cooldownSeconds : 0,
              roleId: typeof body.roleId === "string" ? body.roleId : null
            };

            const result = id === null
              ? await this.options.customCommands!.create(guildId, input)
              : await this.options.customCommands!.update(guildId, id, input);

            if (id !== null && !result) {
              this.json(res, 404, { error: "custom_command_not_found" });
              return;
            }

            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: id === null ? "custom-command.created" : "custom-command.updated",
              targetType: "custom-command",
              targetId: String(id ?? (result as { id?: number })?.id ?? "unknown")
            });
            this.json(res, 200, { ok: true, command: result });
            return;
          }

          if (method === "DELETE" && customCommandItemMatch) {
            const guildId = customCommandItemMatch[1] ?? "";
            const id = Number(customCommandItemMatch[2]);
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || !Number.isSafeInteger(id)) {
              this.json(res, 404, { error: "guild_or_custom_command_not_found" });
              return;
            }
            const deleted = await this.options.customCommands!.delete(guildId, id);
            if (!deleted) {
              this.json(res, 404, { error: "custom_command_not_found" });
              return;
            }
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "custom-command.deleted",
              targetType: "custom-command",
              targetId: String(id)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const generalSettingsMatch = path.match(/^\/api\/guilds\/([^/]+)\/general$/);
          if (generalSettingsMatch) {
            const guildId = generalSettingsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }

            if (method === "GET") {
              this.json(res, 200, {
                guildId,
                settings: await this.options.settings.getGeneral(guildId)
              });
              return;
            }

            if (method === "PUT") {
              const body = await readJson(req);
              const settings = await this.options.settings.setGeneral(guildId, {
                commandPrefix: typeof body.commandPrefix === "string" ? body.commandPrefix : undefined,
                locale: typeof body.locale === "string" ? body.locale : undefined,
                timezone: typeof body.timezone === "string" ? body.timezone : undefined,
                djRoleId: body.djRoleId === null || typeof body.djRoleId === "string" ? body.djRoleId : undefined,
                moderatorRoleIds: Array.isArray(body.moderatorRoleIds) ? body.moderatorRoleIds.filter((v: unknown): v is string => typeof v === "string") : undefined,
                defaultLogChannelId: body.defaultLogChannelId === null || typeof body.defaultLogChannelId === "string" ? body.defaultLogChannelId : undefined
              });
              await this.options.auditLog.record({
                guildId,
                source: "dashboard",
                action: "guild.general.updated",
                targetType: "guild",
                targetId: guildId
              });
              this.json(res, 200, { guildId, settings });
              return;
            }
          }

          const resourcesMatch = path.match(/^\/api\/guilds\/([^/]+)\/resources$/);
          if (method === "GET" && resourcesMatch) {
            const guildId = resourcesMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, guildResources(this.options.client, guildId));
            return;
          }

          const settingsMatch = path.match(/^\/api\/guilds\/([^/]+)\/settings\/([^/]+)$/);
          if (settingsMatch) {
            const guildId = settingsMatch[1];
            const moduleKey = settingsMatch[2] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            if (!moduleExists(moduleKey)) {
              this.json(res, 400, { error: "unknown_module" });
              return;
            }

            if (method === "GET") {
              this.json(res, 200, {
                guildId,
                moduleKey,
                schema: this.options.settings.schema(moduleKey)[0] ?? null,
                values: await this.options.settings.get(guildId, moduleKey)
              });
              return;
            }

            if (method === "PUT") {
              const body = await readJson(req);
              const values = body.values;
              if (!values || typeof values !== "object" || Array.isArray(values)) {
                this.json(res, 400, { error: "values_must_be_object" });
                return;
              }

              const saved = await this.options.settings.set(
                guildId,
                moduleKey,
                values as Record<string, unknown>
              );

              await this.options.auditLog.record({
                guildId,
                source: "dashboard",
                action: "module.settings.updated",
                targetType: "module",
                targetId: moduleKey,
                metadata: { fields: Object.keys(values as object) }
              });

              this.json(res, 200, { guildId, moduleKey, values: saved });
              return;
            }
          }

          const rolePanelsMatch = path.match(/^\/api\/guilds\/([^/]+)\/role-panels$/);
          const rolePanelItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/role-panels\/(\d+)$/);

          if ((rolePanelsMatch || rolePanelItemMatch) && !this.options.rolePanels) {
            this.json(res, 500, { error: "role_panels_unavailable" });
            return;
          }

          if ((method === "POST" || method === "PUT") && (rolePanelsMatch || rolePanelItemMatch)) {
            const guildId = rolePanelsMatch?.[1] ?? rolePanelItemMatch?.[1] ?? "";
            const panelId = rolePanelItemMatch ? Number(rolePanelItemMatch[2]) : null;
            const guild = guildId ? this.options.client.guilds.cache.get(guildId) : null;
            if (!guild || (panelId !== null && !Number.isSafeInteger(panelId))) {
              this.json(res, 404, { error: "guild_or_panel_not_found" });
              return;
            }

            const body = await readJson(req);
            const channelId = body.channelId;
            const title = body.title;
            const rawRoles = body.roles;
            const selectionModeValue = body.selectionMode;
            const selectionMode = typeof selectionModeValue === "string" && ["toggle","exclusive","max"].includes(selectionModeValue)
              ? selectionModeValue as "toggle" | "exclusive" | "max"
              : "toggle";
            const maxSelectionsValue = body.maxSelections;
            const maxSelections = typeof maxSelectionsValue === "number" && Number.isFinite(maxSelectionsValue)
              ? Math.trunc(maxSelectionsValue)
              : 1;
            const durationMinutesValue = body.durationMinutes;
            const durationMinutes = typeof durationMinutesValue === "number" && Number.isFinite(durationMinutesValue)
              ? Math.trunc(durationMinutesValue)
              : 0;

            if (
              typeof channelId !== "string" ||
              channelId.length > 64 ||
              (title !== undefined && (typeof title !== "string" || title.length > 100)) ||
              !["toggle","exclusive","max"].includes(selectionMode) ||
              !Number.isInteger(maxSelections) ||
              maxSelections < 1 ||
              maxSelections > 5 ||
              durationMinutes < 0 ||
              durationMinutes > 43200 ||
              !Array.isArray(rawRoles) ||
              rawRoles.length < 1 ||
              rawRoles.length > 5
            ) {
              throw new RequestInputError("invalid_panel", 400);
            }

            const roles = rawRoles.map((entry) => {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new RequestInputError("invalid_panel", 400);
              const item = entry as Record<string, unknown>;
              if (typeof item.roleId !== "string" || typeof item.label !== "string" || item.roleId.length > 64 || item.label.length > 80 || !item.label.trim()) {
                throw new RequestInputError("invalid_panel", 400);
              }
              return { roleId: item.roleId, label: item.label.trim() };
            });

            const uniqueRoleIds = new Set(roles.map((role) => role.roleId));
            if (uniqueRoleIds.size !== roles.length) throw new RequestInputError("duplicate_roles", 400);

            const channel = guild.channels.cache.get(channelId);
            const botMember = guild.members.me;
            if (!channel || channel.type !== 0) throw new RequestInputError("text_channel_required", 400);
            if (!botMember?.permissions.has("ManageRoles")) throw new RequestInputError("bot_missing_manage_roles", 400);

            for (const entry of roles) {
              const role = guild.roles.cache.get(entry.roleId);
              if (!role || role.managed || role.id === guild.id || role.position >= botMember.roles.highest.position) {
                throw new RequestInputError("role_not_manageable", 400);
              }
            }

            const input = {
              channelId,
              title: typeof title === "string" ? title : undefined,
              roles,
              selectionMode,
              maxSelections,
              durationMinutes
            };

            const helpers = {
              editMessage: async (oldChannelId: string, messageId: string, content: string, components: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[]) => {
                const oldChannel = guild.channels.cache.get(oldChannelId);
                if (!oldChannel || oldChannel.type !== 0) throw new Error("role_panel_old_channel_missing");
                const message = await oldChannel.messages.fetch(messageId);
                await message.edit({ content, components });
              },
              deleteMessage: async (oldChannelId: string, messageId: string) => {
                const oldChannel = guild.channels.cache.get(oldChannelId);
                if (!oldChannel || oldChannel.type !== 0) return;
                await oldChannel.messages.delete(messageId).catch(() => undefined);
              },
              sendMessage: async (newChannelId: string, content: string, components: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[]) => {
                const target = guild.channels.cache.get(newChannelId);
                if (!target || target.type !== 0) throw new Error("role_panel_channel_missing");
                const message = await target.send({ content, components });
                return message.id;
              }
            };

            const result = panelId === null
              ? await this.options.rolePanels!.create(guildId, input, helpers)
              : await this.options.rolePanels!.update(guildId, panelId, input, helpers);

            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: panelId === null ? "role-panel.created" : "role-panel.updated",
              targetType: "role-panel",
              targetId: String((result as { id?: number })?.id ?? panelId ?? "unknown")
            });
            this.json(res, 200, { ok: true, panel: result });
            return;
          }

          if (method === "GET" && rolePanelsMatch) {
            const guildId = rolePanelsMatch[1] ?? "";
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            this.json(res, 200, { guildId, panels: await this.options.rolePanels!.list(guildId) });
            return;
          }

          if (method === "DELETE" && rolePanelItemMatch) {
            const guildId = rolePanelItemMatch[1] ?? "";
            const panelId = Number(rolePanelItemMatch[2]);
            if (!guildId || !this.options.client.guilds.cache.has(guildId) || !Number.isSafeInteger(panelId)) {
              this.json(res, 404, { error: "guild_or_panel_not_found" });
              return;
            }

            const deleted = await this.options.rolePanels!.delete(
              guildId,
              panelId,
              async (channelId: string, messageId: string) => {
                const channel = this.options.client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
                if (!channel || channel.type !== 0) return;
                await channel.messages.delete(messageId).catch(() => undefined);
              }
            );
            if (!deleted) {
              this.json(res, 404, { error: "panel_not_found" });
              return;
            }

            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: "role-panel.deleted",
              targetType: "role-panel",
              targetId: String(panelId)
            });
            this.json(res, 200, { ok: true });
            return;
          }

          const schemasMatch = path === "/api/module-schemas"; 
          if (method === "GET" && schemasMatch) {
            this.json(res, 200, { schemas: this.options.settings.schema() });
            return;
          }

          const auditMatch = path.match(/^\/api\/guilds\/([^/]+)\/audit$/);
          if (method === "GET" && auditMatch) {
            const guildId = auditMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }

            const limitRaw = url.searchParams.get("limit");
            const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
            if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
              this.json(res, 400, { error: "invalid_limit" });
              return;
            }

            this.json(res, 200, {
              guildId,
              events: await this.options.auditLog.recent(guildId, limit)
            });
            return;
          }

          const moduleMatch = path.match(/^\/api\/guilds\/([^/]+)\/modules\/([^/]+)$/);
          if (method === "PUT" && moduleMatch) {
            const guildId = moduleMatch[1];
            const moduleKey = moduleMatch[2] as ModuleKey;

            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            if (!MODULE_CATALOG.some((module) => module.key === moduleKey)) {
              this.json(res, 400, { error: "unknown_module" });
              return;
            }

            const body = await readJson(req);
            if (typeof body.enabled !== "boolean") {
              this.json(res, 400, { error: "enabled_must_be_boolean" });
              return;
            }

            await this.options.moduleSettings.set(guildId, moduleKey, body.enabled);
            await this.options.auditLog.record({
              guildId,
              source: "dashboard",
              action: body.enabled ? "module.enabled" : "module.disabled",
              targetType: "module",
              targetId: moduleKey,
              metadata: {}
            });

            this.json(res, 200, { guildId, moduleKey, enabled: body.enabled });
            return;
          }

          this.json(res, 404, { error: "not_found" });
        } catch (error) {
          if (error instanceof RequestInputError) {
            this.json(res, error.status, { error: error.code });
            return;
          }

          logger.error("Management API request failed", {
            method: requestMethod,
            path: requestPath,
            ip,
            durationMs: Date.now() - requestStartedAt,
            error: String(error)
          });
          this.json(res, 500, { error: "internal_error" });
        }
      });

      this.server.once("error", reject);
      this.server.listen(this.options.port, this.options.host, () => {
        logger.info("Management API listening", { host: this.options.host, port: this.options.port });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    if (this.rateCleanupTimer) clearInterval(this.rateCleanupTimer);
    this.rateCleanupTimer = undefined;
    this.rateWindows.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private cleanupRateWindows(): void {
    const cutoff = Date.now() - 60_000;
    for (const [key, window] of this.rateWindows) {
      if (window.startedAt < cutoff) this.rateWindows.delete(key);
    }

    if (this.rateWindows.size <= 10_000) return;

    const oldest = [...this.rateWindows.entries()]
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
      .slice(0, this.rateWindows.size - 10_000);

    for (const [key] of oldest) this.rateWindows.delete(key);

    logger.warn("Management API rate-limit state trimmed", {
      removed: oldest.length,
      remaining: this.rateWindows.size
    });
  }

  private authorized(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const received = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(this.options.apiKey);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  private allowedRate(key: string): boolean {
    const now = Date.now();
    const window = this.rateWindows.get(key);

    if (!window || now - window.startedAt >= 60_000) {
      this.rateWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }

    window.count += 1;
    return window.count <= 120;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(JSON.stringify(body));
  }
}

class RequestInputError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}

function validateAutomationPayload(
  client: Client,
  guildId: string,
  event: string,
  conditions: unknown[],
  actions: unknown[],
  depth = 0
): void {
  const supportedEvents = new Set([
    "member.join","member.leave","member.role.add","member.role.remove",
    "message.create","message.delete","message.edit","reaction.add","reaction.remove",
    "channel.delete","role.delete","member.ban",
    "voice.join","voice.leave","voice.move","moderation.case",
    "ticket.create","ticket.close","giveaway.end","schedule"
  ]);
  if (!supportedEvents.has(event)) throw new RequestInputError("unsupported_automation_event", 400);
  if (depth > 2) throw new RequestInputError("automation_branch_too_deep", 400);

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new RequestInputError("guild_not_found", 404);

  const stringFields = new Set(["content","userId","moderatorUserId","channelId","roleId","action","reason","messageId","guildId"]);
  const numericFields = new Set(["memberCount","messageLength","mentionCount","previousLength","caseId","ticketId","giveawayId","winnerCount","timestamp","minute","hour","dayOfWeek","dayOfMonth"]);

  for (const condition of conditions) validateAutomationCondition(condition, guild, stringFields, numericFields);

  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new RequestInputError("invalid_automation_action", 400);
    }
    const item = action as Record<string, unknown>;
    switch (item.type) {
      case "log":
        if (typeof item.message !== "string" || !item.message.length || item.message.length > 1000) throw new RequestInputError("invalid_log_action", 400);
        break;
      case "send-message": {
        if (typeof item.channelId !== "string" || typeof item.content !== "string" || !item.content.length || item.content.length > 2000) throw new RequestInputError("invalid_send_message_action", 400);
        const channel = guild.channels.cache.get(item.channelId);
        if (!channel || channel.type !== 0) throw new RequestInputError("invalid_send_message_channel", 400);
        break;
      }
      case "dm-user":
        if (!isAutomationUserRef(item.userId) || typeof item.content !== "string" || !item.content.length || item.content.length > 2000) throw new RequestInputError("invalid_dm_action", 400);
        break;
      case "add-role":
      case "remove-role":
        if (!isAutomationUserRef(item.userId) || typeof item.roleId !== "string" || !/^\\d{17,20}$/.test(item.roleId) || !guild.roles.cache.get(item.roleId)) throw new RequestInputError("invalid_role_action", 400);
        break;
      case "timeout":
        if (!isAutomationUserRef(item.userId) || typeof item.durationSeconds !== "number" || !Number.isInteger(item.durationSeconds) || item.durationSeconds < 1 || item.durationSeconds > 2419200 || typeof item.reason !== "string" || !item.reason.length || item.reason.length > 500) throw new RequestInputError("invalid_timeout_action", 400);
        break;
      case "warn":
      case "kick":
        if (!isAutomationUserRef(item.userId) || typeof item.reason !== "string" || !item.reason.length || item.reason.length > 500) throw new RequestInputError("invalid_" + item.type + "_action", 400);
        break;
      case "ban":
        if (!isAutomationUserRef(item.userId) || typeof item.reason !== "string" || !item.reason.length || item.reason.length > 500 ||
            (item.durationMinutes !== undefined && (typeof item.durationMinutes !== "number" || !Number.isInteger(item.durationMinutes) || item.durationMinutes < 1 || item.durationMinutes > 40320))) {
          throw new RequestInputError("invalid_ban_action", 400);
        }
        break;
      case "delete-message":
        if (typeof item.channelId !== "string" || (item.channelId !== "@event" && !/^\d{17,20}$/.test(item.channelId)) ||
            typeof item.messageId !== "string" || (item.messageId !== "@event" && !/^\d{17,20}$/.test(item.messageId))) throw new RequestInputError("invalid_delete_message_action", 400);
        if (item.channelId !== "@event") {
          const channel = guild.channels.cache.get(item.channelId);
          if (!channel || !channel.isTextBased()) throw new RequestInputError("invalid_delete_message_channel", 400);
        }
        break;
      case "delay":
        if (typeof item.seconds !== "number" || !Number.isInteger(item.seconds) || item.seconds < 1 || item.seconds > 3600) throw new RequestInputError("invalid_delay_action", 400);
        break;
      case "webhook":
        if (typeof item.url !== "string" || !/^https:\/\/[^\s<>]+$/i.test(item.url) || item.url.length > 2000 ||
            typeof item.content !== "string" || !item.content.length || item.content.length > 2000) throw new RequestInputError("invalid_webhook_action", 400);
        break;
      case "branch":
        if (!item.condition || typeof item.condition !== "object" || Array.isArray(item.condition) ||
            !Array.isArray(item.thenActions) || item.thenActions.length < 1 || item.thenActions.length > 10 ||
            !Array.isArray(item.elseActions) || item.elseActions.length > 10) {
          throw new RequestInputError("invalid_branch_action", 400);
        }
        validateAutomationCondition(item.condition, guild, stringFields, numericFields);
        validateAutomationPayload(client, guildId, event, [], item.thenActions, depth + 1);
        if (item.elseActions.length > 0) validateAutomationPayload(client, guildId, event, [], item.elseActions, depth + 1);
        break;
      default:
        throw new RequestInputError("unsupported_automation_action", 400);
    }
  }

  function isAutomationUserRef(value: unknown): value is string {
    return typeof value === "string" && (value === "@event" || /^\d{17,20}$/.test(value));
  }

  function validateAutomationCondition(
    condition: unknown,
    currentGuild: import("discord.js").Guild,
    allowedStringFields: Set<string>,
    allowedNumericFields: Set<string>
  ): void {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new RequestInputError("invalid_automation_condition", 400);
    const item = condition as Record<string, unknown>;
    switch (item.type) {
      case "channel-is": {
        if (typeof item.channelId !== "string" || !/^\d{17,20}$/.test(item.channelId)) throw new RequestInputError("invalid_condition_channel", 400);
        const channel = currentGuild.channels.cache.get(item.channelId);
        if (!channel || !channel.isTextBased()) throw new RequestInputError("invalid_condition_channel", 400);
        break;
      }
      case "contains":
      case "equals":
        if (typeof item.left !== "string" || !allowedStringFields.has(item.left) || typeof item.right !== "string" || item.right.length > 200) throw new RequestInputError("invalid_content_condition", 400);
        break;
      case "matches":
        if (typeof item.left !== "string" || !allowedStringFields.has(item.left) || typeof item.pattern !== "string" || item.pattern.length > 120) throw new RequestInputError("invalid_regex_condition", 400);
        try { new RegExp(item.pattern); } catch { throw new RequestInputError("invalid_regex_condition", 400); }
        break;
      case "number-gte":
      case "number-lte":
        if (typeof item.left !== "string" || !allowedNumericFields.has(item.left) || typeof item.right !== "number" || !Number.isFinite(item.right)) throw new RequestInputError("invalid_numeric_condition", 400);
        break;
      case "has-role":
        if (typeof item.userId !== "string" || !/^\d{17,20}$/.test(item.userId) ||
            typeof item.roleId !== "string" || !/^\d{17,20}$/.test(item.roleId) || !currentGuild.roles.cache.has(item.roleId)) throw new RequestInputError("invalid_role_condition", 400);
        break;
      case "cooldown-clear":
        if (typeof item.key !== "string" || !item.key.trim() || item.key.length > 100) throw new RequestInputError("invalid_cooldown_key", 400);
        break;
      default:
        throw new RequestInputError("unsupported_automation_condition", 400);
    }
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) {
      throw new RequestInputError("request_too_large", 413);
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestInputError("invalid_json", 400);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestInputError("invalid_json_object", 400);
  }

  return parsed as Record<string, unknown>;
}
