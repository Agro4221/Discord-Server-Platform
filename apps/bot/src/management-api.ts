import { createServer, type Server } from "node:http";
import type { Client } from "discord.js";
import { logger } from "./logger.js";
import { ModuleSettingsRepository } from "./module-settings.js";
import { MODULE_CATALOG, type ModuleKey } from "./modules/catalog.js";

type ApiOptions = {
  host: string;
  port: number;
  apiKey: string;
  client: Client;
  moduleSettings: ModuleSettingsRepository;
};

export class ManagementApiServer {
  private server?: Server;

  constructor(private readonly options: ApiOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        try {
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
            this.json(res, 200, {
              guildId,
              catalog: MODULE_CATALOG,
              modules
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
            this.json(res, 200, { guildId, moduleKey, enabled: body.enabled });
            logger.info("Guild module toggled", { guildId, moduleKey, enabled: body.enabled });
            return;
          }

          this.json(res, 404, { error: "not_found" });
        } catch (error) {
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
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  private authorized(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    return header.slice("Bearer ".length) === this.options.apiKey;
  }

  private json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(JSON.stringify(body));
  }
}

async function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw new Error("request_too_large");
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};

  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_json_object");
  }
  return parsed as Record<string, unknown>;
}
