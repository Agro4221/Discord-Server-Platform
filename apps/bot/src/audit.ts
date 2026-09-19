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

export class AuditLog {
  constructor(private readonly db: Database) {}

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
  }

  async recent(guildId: string, limit = 50): Promise<Record<string, unknown>[]> {
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
  }
}
