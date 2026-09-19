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
  actions: Record<string, (guildId: string) => Promise<unknown>>;
  giveaways?: {
    list: (guildId: string) => Promise<unknown[]>;
    end: (guildId: string, giveawayId: number) => Promise<unknown>;
    reroll: (guildId: string, giveawayId: number) => Promise<unknown>;
  };
  analytics?: {
    report: (guildId: string, hours?: number) => Promise<unknown>;
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

  constructor(private readonly options: ApiOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        try {
          const ip = req.socket.remoteAddress ?? "unknown";
          if (!this.allowedRate(ip)) {
            this.json(res, 429, { error: "rate_limited" });
            return;
          }

          if (!this.authorized(req.headers.authorization)) {
            this.json(res, 401, { error: "unauthorized" });
            return;
          }

          const method = req.method ?? "GET";
          const url = new URL(req.url ?? "/", `http://${this.options.host}:${this.options.port}`);
          const path = url.pathname;

          if (method === "GET" && path === "/api/guilds") {
            const guilds = [...this.options.client.guilds.cache.values()].map((guild) => ({
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
            const actions = body.actions;
            const cooldownSeconds = body.cooldownSeconds;

            if (
              typeof name !== "string" || name.trim().length < 1 || name.length > 80 ||
              typeof event !== "string" || event.length > 64 ||
              !Array.isArray(conditions) || conditions.length > 10 ||
              !Array.isArray(actions) || actions.length < 1 || actions.length > 10 ||
              typeof cooldownSeconds !== "number" || !Number.isFinite(cooldownSeconds) ||
              cooldownSeconds < 0 || cooldownSeconds > 86400
            ) {
              throw new RequestInputError("invalid_automation_rule", 400);
            }

            validateAutomationPayload(this.options.client, guildId, event, conditions, actions);

            const input = {
              name: name.trim(),
              event,
              conditions,
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

          logger.error("Management API request failed", { error: String(error) });
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
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

async function validateAutomationPayload(
  client: Client,
  guildId: string,
  event: string,
  conditions: unknown[],
  actions: unknown[]
): void {
  const supportedEvents = new Set([
    "member.join","member.leave","message.create","voice.join","voice.leave","voice.move"
  ]);
  if (!supportedEvents.has(event)) throw new RequestInputError("unsupported_automation_event", 400);

  for (const condition of conditions) {
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      throw new RequestInputError("invalid_automation_condition", 400);
    }
    const item = condition as Record<string, unknown>;
    if (item.type === "channel-is") {
      if (typeof item.channelId !== "string") throw new RequestInputError("invalid_condition_channel", 400);
      const channel = client.guilds.cache.get(guildId)?.channels.cache.get(item.channelId);
      if (!channel || channel.type !== 0) throw new RequestInputError("invalid_condition_channel", 400);
      continue;
    }
    if (item.type === "contains" || item.type === "equals") {
      if (item.left !== "content" || typeof item.right !== "string" || item.right.length > 200) {
        throw new RequestInputError("invalid_content_condition", 400);
      }
      continue;
    }
    throw new RequestInputError("unsupported_automation_condition", 400);
  }

  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new RequestInputError("invalid_automation_action", 400);
    }
    const item = action as Record<string, unknown>;
    if (item.type === "log") {
      if (typeof item.message !== "string" || item.message.length > 1000) {
        throw new RequestInputError("invalid_log_action", 400);
      }
      continue;
    }
    if (item.type === "send-message") {
      if (typeof item.channelId !== "string" || typeof item.content !== "string" || item.content.length > 2000) {
        throw new RequestInputError("invalid_send_message_action", 400);
      }
      const channel = client.guilds.cache.get(guildId)?.channels.cache.get(item.channelId);
      if (!channel || channel.type !== 0) throw new RequestInputError("invalid_send_message_channel", 400);
      continue;
    }
    throw new RequestInputError("unsupported_automation_action", 400);
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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
