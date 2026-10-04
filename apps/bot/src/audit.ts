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
  actionPrefixes?: string[];
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
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
        .setDescription(metadata === "{}" ? " " : "\`\`\`json\n" + metadata.slice(0, 3500) + "\n\`\`\`")
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch {
      // Discord audit delivery is best-effort; DB remains source of truth.
    }
  }

  async recent(guildId: string, limit = 50): Promise<Record<string, unknown>[]> {
    return this.query(guildId, { limit });
  }

  async moduleActivity(
    guildId: string,
    moduleKey: string,
    limit = 50,
    before?: string
  ): Promise<Record<string, unknown>[]> {
    const prefixes: Record<string, string[]> = {
      moderation: ["moderation."],
      automod: ["automod."],
      security: ["security."],
      "temporary-voice": ["temporary-voice.", "temp-voice."],
      welcome: ["welcome."],
      verification: ["verification."],
      onboarding: ["onboarding."],
      roles: ["role-panel.", "role.", "role_automation."],
      leveling: ["leveling."],
      tickets: ["ticket.", "tickets."],
      giveaways: ["giveaway."],
      starboard: ["starboard."],
      economy: ["economy.", "shop."],
      reminders: ["reminder.", "schedule.", "sticky.", "afk."],
      notifications: ["notification.", "feed."],
      automation: ["automation."],
      music: ["music."],
      analytics: ["analytics."],
      polls: ["poll.", "suggestion."],
      reputation: ["rep.", "profile."],
      birthdays: ["birthday."],
      "invite-tracking": ["invite."],
      "stream-alerts": ["stream.", "streamalert."],
      forms: ["form.", "forms."],
      "custom-commands": ["custom-command.", "command-policy."],
      autoresponder: ["autoresponder."]
    };
    const actionPrefixes = prefixes[moduleKey] ?? ["module.settings.", "module.action"];

    return this.query(guildId, { limit, before, actionPrefixes });
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
      const pattern = "%" + options.action.trim().replace(/[%_]/g, "\\$&") + "%";
      values.push(pattern);
      conditions.push("action ILIKE $" + values.length + " ESCAPE '\\'");
    }

    if (options.actionPrefixes?.length) {
      const prefixes = [...new Set(
        options.actionPrefixes.map((value) => value.trim()).filter(Boolean)
      )].slice(0, 20);

      if (prefixes.length) {
        const prefixConditions = prefixes.map((prefix) => {
          values.push(prefix.replace(/[%_]/g, "\\$&") + "%");
          return "action ILIKE $" + values.length + " ESCAPE '\\'";
        });
        conditions.push("(" + prefixConditions.join(" OR ") + ")");
      }
    }

    if (options.actorUserId) {
      values.push(options.actorUserId);
      conditions.push("actor_user_id=$" + values.length);
    }

    if (options.targetType) {
      values.push(options.targetType);
      conditions.push("target_type=$" + values.length);
    }

    if (options.targetId) {
      values.push(options.targetId);
      conditions.push("target_id=$" + values.length);
    }

    if (options.before) {
      const parsed = new Date(options.before);
      if (!Number.isNaN(parsed.getTime())) {
        values.push(parsed.toISOString());
        conditions.push("created_at < $" + values.length);
      }
    }

    values.push(safeLimit);
    const limitParam = "$" + values.length;
    const result = await this.db.query(
      `SELECT id,guild_id,actor_user_id,source,action,target_type,target_id,metadata,created_at
         FROM audit_events
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC,id DESC
        LIMIT ${limitParam}`,
      values
    );
    return result.rows;
  }}
