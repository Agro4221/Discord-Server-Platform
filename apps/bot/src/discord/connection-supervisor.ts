import { Events, type Client } from "discord.js";
import { logger } from "../logger.js";

export type DiscordHealth = "connecting" | "ready" | "down";

export class ConnectionSupervisor {
  private status: DiscordHealth = "connecting";
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly client: Client,
    private readonly setHealth: (status: DiscordHealth) => void
  ) {}

  start(): void {
    this.bind(Events.ClientReady, () => this.update("ready", "gateway ready"));
    this.bind(Events.ShardReady, (shardId: number) => {
      logger.info("Discord shard ready", { shardId });
      this.update("ready", `shard ${shardId} ready`);
    });
    this.bind(Events.ShardReconnecting, (shardId: number) => {
      logger.warn("Discord shard reconnecting", { shardId });
      this.update("connecting", `shard ${shardId} reconnecting`);
    });
    this.bind(Events.ShardDisconnect, (event: { code: number; reason: string }, shardId: number) => {
      logger.warn("Discord shard disconnected", {
        shardId,
        code: event.code,
        reason: event.reason
      });
      this.update("connecting", `shard ${shardId} disconnected`);
    });
    this.bind(Events.Invalidated, () => {
      logger.error("Discord session invalidated");
      this.update("down", "session invalidated");
    });
    this.bind(Events.Error, (error: Error) => {
      logger.error("Discord client error", { error: error.message });
    });
  }

  stop(): void {
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
  }

  getStatus(): DiscordHealth {
    return this.status;
  }

  private update(status: DiscordHealth, reason: string): void {
    this.status = status;
    this.setHealth(status);
    logger.info("Discord connection health changed", { status, reason });
  }

  private bind(event: string, handler: (...args: any[]) => void): void {
    this.client.on(event as never, handler as never);
    this.listeners.push(() => this.client.off(event as never, handler as never));
  }
}
