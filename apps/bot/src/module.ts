import type { Client } from "discord.js";
import type { AuditLog } from "./audit.js";
import type { Database } from "./database.js";
import type { PlatformEventBus } from "./events.js";

export type ModuleContext = {
  signal: AbortSignal;
  client: Client;
  db: Database;
  auditLog: AuditLog;
  events: PlatformEventBus;
  identityId: string;
};

export interface PlatformModule {
  readonly name: string;
  init(context: ModuleContext): Promise<void>;
  shutdown(): Promise<void>;
}
