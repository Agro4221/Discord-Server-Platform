import type { Client } from "discord.js";
import type { AuditLog } from "./audit.js";
import type { Database } from "./database.js";
import type { PlatformEventBus } from "./events.js";

export type ModuleHealthStatus = "starting" | "ready" | "degraded" | "down";

export type ModuleContext = {
  signal: AbortSignal;
  client: Client;
  db: Database;
  auditLog: AuditLog;
  events: PlatformEventBus;
  identityId: string;
  setModuleHealth?: (name: string, status: ModuleHealthStatus) => void;
};

export interface PlatformModule {
  readonly name: string;
  init(context: ModuleContext): Promise<void>;
  shutdown(): Promise<void>;
}
