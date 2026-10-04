import { EmbedBuilder, type Client } from "discord.js";
import type { Database } from "./database.js";

export type AuditEvent = {

  guildId?: string | null;
  actorUserId?: string | null;
  source: "discord" | "dashboard" | "system";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AuditQuery = {
  limit?: number;
  source?: AuditEvent["source"];
  action?: string;
  actorUserId?: string;
  before?: string;
};

export class AuditLog {
  private client?: Client;

  constructor(private readonly db: Database) {}

  setClient(client: Client): void {
    this.client = client;
  }

  async record(event: AuditEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_events
       (guild_id,actor_user_id,source,action,target_type,target_id,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        event.guildId ?? null,
        event.actorUserId ?? null,
        event.source,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        JSON.stringify(event.metadata ?? {})
      ]
    );

    if (!event.guildId || !this.client) return;

    try {
      const result = await this.db.query<{
        audit_log_enabled: boolean;
        default_log_channel_id: string | null;
      }>(
        "SELECT audit_log_enabled,default_log_channel_id FROM guild_settings WHERE guild_id=$1",
        [event.guildId]
      );
      const row = result.rows[0];
      if (!row?.audit_log_enabled || !row.default_log_channel_id) return;

      const channel = this.client.channels.cache.get(row.default_log_channel_id);
      if (!channel?.isTextBased() || !("send" in channel)) return;

      const metadata = JSON.stringify(event.metadata ?? {});
      const embed = new EmbedBuilder()
        .setTitle("Audit · " + event.action)
        .addFields(
          { name: "Источник", value: event.source, inline: true },
          { name: "Актор", value: event.actorUserId ? "<@" + event.actorUserId + ">" : "system", inline: true },
          { name: "Цель", value: event.targetId ?? "—", inline: true }
        )
        .setDescription(metadata === "{}" ? " " : "```json\n" + metadata.slice(0, 3500) + "\n```")
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch {
      // Discord audit delivery is best-effort; DB remains source of truth.
    }
  }

  async recent(guildId: string, limit = 50): Promise<Record<string, unknown>[]> {
    return this.query(guildId, { limit });
  }

  async query(guildId: string, options: AuditQuery = {}): Promise<Record<string, unknown>[]> {
    const safeLimit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const values: unknown[] = [guildId];
    const conditions = ["guild_id=$1"];

    if (options.source) {
      values.push(options.source);
      conditions.push("source=$" + values.length);
    }
    if (options.action) {
      values.push("%" + options.action.trim().replace(/[%_]/g, "\\  async recent(guildId: string, limit = 50): Promise<Record<string, unknown>[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const result = await this.db.query(
      `SELECT id,guild_id,actor_user_id,source,action,target_type,target_id,metadata,created_at
       FROM audit_events
       WHERE guild_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [guildId, safeLimit]
    );
    return result.rows;
  }") + "%");
      conditions.push("action ILIKE $" + values.length + " ESCAPE '\\'");
    }
    if (options.actorUserId) {
      values.push(options.actorUserId);
      conditions.push("actor_user_id=$" + values.length);
    }
    if (options.before) {
      const parsed = new Date(options.before);
      if (!Number.isNaN(parsed.getTime())) {
        values.push(parsed.toISOString());
        conditions.push("created_at < $" + values.length);
      }
    }

    values.push(safeLimit);
    const result = await this.db.query(
      `SELECT id,guild_id,actor_user_id,source,action,target_type,target_id,metadata,created_at
         FROM audit_events
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC,id DESC
        LIMIT ${values.length}`,
      values
    );
    return result.rows;
  }
}
