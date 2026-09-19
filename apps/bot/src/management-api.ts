import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Client } from "discord.js";
import { logger } from "./logger.js";
import { ModuleSettingsRepository } from "./module-settings.js";
import { MODULE_CATALOG, type ModuleKey } from "./modules/catalog.js";
import { AuditLog } from "./audit.js";
import { DashboardSettingsService, moduleExists } from "./dashboard-settings.js";
import { guildResources } from "./discord/resources.js";
import { ConfigTransferService } from "./config-transfer.js";
import { BackupService } from "./backup.js";
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
    update: (guildId: string, feedId: number, input: { channelId?: string; url?: string; intervalSeconds?: number; enabled?: boolean }) => Promise<boolean>;
    delete: (guildId: string, feedId: number) => Promise<boolean>;
  };
  automation?: {
    list: (guildId: string) => Promise<unknown[]>;
    create: (guildId: string, input: {
      name: string;
      event: string;
      conditions: unknown[];
      actions: unknown[];
      cooldownSeconds: number;
    }) => Promise<unknown>;
    update: (guildId: string, ruleId: string, input: {
      name: string;
      event: string;
      conditions: unknown[];
      actions: unknown[];
      cooldownSeconds: number;
      enabled?: boolean;
    }) => Promise<boolean>;
    delete: (guildId: string, ruleId: string) => Promise<boolean>;
  };
  rolePanels?: {
    list: (guildId: string) => Promise<unknown[]>;
    create: (
      guildId: string,
      input: { channelId: string; title?: string; roles: Array<{ roleId: string; label: string }> },
      callbacks: {
        deleteMessage: (channelId: string, messageId: string) => Promise<void>;
        sendMessage: (channelId: string, content: string, components: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[]) => Promise<string>;
      }
    ) => Promise<unknown>;
    update: (
      guildId: string,
      panelId: number,
      input: { channelId: string; title?: string; roles: Array<{ roleId: string; label: string }> },
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
              icon: guild.iconURL({ size: 64 })
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
          const giveawayActionMatch = path.match(/^\/api\/guilds\/([^/]+)\/giveaways\/(\\d+)\/(end|reroll)$/);

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

            const input: { channelId?: string; url?: string; intervalSeconds?: number; enabled?: boolean } = {};
            if (typeof body.channelId === "string") input.channelId = body.channelId;
            if (typeof body.url === "string") input.url = body.url;
            if (typeof body.intervalSeconds === "number") input.intervalSeconds = body.intervalSeconds;
            if (typeof body.enabled === "boolean") input.enabled = body.enabled;

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
          const automationItemMatch = path.match(/^\/api\/guilds\/([^/]+)\/automation\/([^/]+)$/);

          if ((automationMatch || automationItemMatch) && !this.options.automation) {
            this.json(res, 500, { error: "automation_unavailable" });
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

            if (
              typeof channelId !== "string" ||
              channelId.length > 64 ||
              (title !== undefined && (typeof title !== "string" || title.length > 100)) ||
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
              roles
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
  actions: unknown[]
): void {
  const supportedEvents = new Set([
    "member.join","member.leave","member.role.add","member.role.remove",
    "message.create","message.delete","message.edit","reaction.add",
    "voice.join","voice.leave","voice.move","moderation.case",
    "ticket.create","ticket.close","giveaway.end","schedule"
  ]);
  if (!supportedEvents.has(event)) throw new RequestInputError("unsupported_automation_event", 400);

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new RequestInputError("guild_not_found", 404);

  const stringFields = new Set(["content","userId","channelId","messageId","guildId"]);
  const numericFields = new Set(["memberCount","messageLength","mentionCount","previousLength","giveawayId","winnerCount","timestamp","minute","hour","dayOfWeek","dayOfMonth"]);

  for (const condition of conditions) {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      throw new RequestInputError("invalid_automation_condition", 400);
    }
    const item = condition as Record<string, unknown>;
    switch (item.type) {
      case "channel-is": {
        if (typeof item.channelId !== "string" || !/^\\d{17,20}$/.test(item.channelId)) throw new RequestInputError("invalid_condition_channel", 400);
        const channel = guild.channels.cache.get(item.channelId);
        if (!channel || !channel.isTextBased()) throw new RequestInputError("invalid_condition_channel", 400);
        break;
      }
      case "contains":
      case "equals":
        if (typeof item.left !== "string" || !stringFields.has(item.left) || typeof item.right !== "string" || item.right.length > 200) {
          throw new RequestInputError("invalid_content_condition", 400);
        }
        break;
      case "matches":
        if (typeof item.left !== "string" || !stringFields.has(item.left) || typeof item.pattern !== "string" || item.pattern.length > 120) {
          throw new RequestInputError("invalid_regex_condition", 400);
        }
        try { new RegExp(item.pattern); } catch { throw new RequestInputError("invalid_regex_condition", 400); }
        break;
      case "number-gte":
      case "number-lte":
        if (typeof item.left !== "string" || !numericFields.has(item.left) || typeof item.right !== "number" || !Number.isFinite(item.right)) {
          throw new RequestInputError("invalid_numeric_condition", 400);
        }
        break;
      case "has-role":
        if (typeof item.userId !== "string" || (!/^\\d{17,20}$/.test(item.userId)) ||
            typeof item.roleId !== "string" || !/^\\d{17,20}$/.test(item.roleId) ||
            !guild.roles.cache.has(item.roleId)) {
          throw new RequestInputError("invalid_role_condition", 400);
        }
        break;
      case "cooldown-clear":
        if (typeof item.key !== "string" || !item.key.trim() || item.key.length > 100) throw new RequestInputError("invalid_cooldown_key", 400);
        break;
      default:
        throw new RequestInputError("unsupported_automation_condition", 400);
    }
  }

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
        if (typeof item.channelId !== "string" || typeof item.content !== "string" || !item.content.length || item.content.length > 2000) {
          throw new RequestInputError("invalid_send_message_action", 400);
        }
        const channel = guild.channels.cache.get(item.channelId);
        if (!channel || channel.type !== 0) throw new RequestInputError("invalid_send_message_channel", 400);
        break;
      }
      case "dm-user":
        if (typeof item.userId !== "string" || (item.userId !== "@event" && !/^\\d{17,20}$/.test(item.userId)) ||
            typeof item.content !== "string" || !item.content.length || item.content.length > 2000) {
          throw new RequestInputError("invalid_dm_action", 400);
        }
        break;
      case "add-role":
      case "remove-role":
        if (typeof item.userId !== "string" || (item.userId !== "@event" && !/^\\d{17,20}$/.test(item.userId)) ||
            typeof item.roleId !== "string" || !/^\\d{17,20}$/.test(item.roleId) ||
            !guild.roles.cache.get(item.roleId)) {
          throw new RequestInputError("invalid_role_action", 400);
        }
        break;
      case "timeout":
        if (typeof item.userId !== "string" || (item.userId !== "@event" && !/^\\d{17,20}$/.test(item.userId)) ||
            typeof item.durationSeconds !== "number" || !Number.isInteger(item.durationSeconds) || item.durationSeconds < 1 || item.durationSeconds > 2419200 ||
            typeof item.reason !== "string" || !item.reason.length || item.reason.length > 500) {
          throw new RequestInputError("invalid_timeout_action", 400);
        }
        break;
      case "delete-message": {
        if (typeof item.channelId !== "string" || (item.channelId !== "@event" && !/^\\d{17,20}$/.test(item.channelId)) ||
            typeof item.messageId !== "string" || (item.messageId !== "@event" && !/^\\d{17,20}$/.test(item.messageId))) {
          throw new RequestInputError("invalid_delete_message_action", 400);
        }
        if (item.channelId !== "@event") {
          const channel = guild.channels.cache.get(item.channelId);
          if (!channel || !channel.isTextBased()) throw new RequestInputError("invalid_delete_message_channel", 400);
        }
        break;
      }
      default:
        throw new RequestInputError("unsupported_automation_action", 400);
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
