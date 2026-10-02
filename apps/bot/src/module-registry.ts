import type { Client } from "discord.js";
import type { AuditLog } from "./audit.js";
import type { Database } from "./database.js";
import type { PlatformEventBus } from "./events.js";
import type { PlatformModule } from "./module.js";
import { logger } from "./logger.js";

export type ModuleInitStatus = "ready" | "degraded";

export type ModuleServices = {
  client: Client;
  db: Database;
  auditLog: AuditLog;
  events: PlatformEventBus;
  identityId: string;
  setModuleHealth?: (name: string, status: import("./module.js").ModuleHealthStatus) => void;
};

export class ModuleRegistry {
  private readonly modules = new Map<string, PlatformModule>();
  private readonly controller = new AbortController();

  constructor(private readonly services: ModuleServices) {}

  register(module: PlatformModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module already registered: ${module.name}`);
    }
    this.modules.set(module.name, module);
  }

  list(): string[] {
    return [...this.modules.keys()];
  }

  async initAll(): Promise<Record<string, ModuleInitStatus>> {
    const status: Record<string, ModuleInitStatus> = {};

    for (const module of this.modules.values()) {
      try {
        await module.init({ signal: this.controller.signal, ...this.services });
        status[module.name] = "ready";
        logger.info("Module ready", { module: module.name });
      } catch (error) {
        status[module.name] = "degraded";
        logger.error("Module initialization failed; continuing", {
          module: module.name,
          error: String(error)
        });
      }
    }

    return status;
  }

  async shutdownAll(): Promise<void> {
    this.controller.abort();

    for (const module of [...this.modules.values()].reverse()) {
      try {
        await module.shutdown();
      } catch (error) {
        logger.error("Module shutdown failed", {
          module: module.name,
          error: String(error)
        });
      }
    }
  }
}
