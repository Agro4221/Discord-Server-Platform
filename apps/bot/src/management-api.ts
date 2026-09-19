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
          if (method === "GET" && backupsMatch) {
            const guildId = backupsMatch[1];
            if (!guildId || !this.options.client.guilds.cache.has(guildId)) {
              this.json(res, 404, { error: "guild_not_found" });
              return;
            }
            const backups = await this.options.backups.listBackups();
            this.json(res, 200, { guildId, backups });
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
