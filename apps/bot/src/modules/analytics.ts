import type { ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type PendingAnalytics = {
  guildId: string;
  eventType: string;
  bucketStart: Date;
  count: number;
};

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_LIMIT = 1_000;
const MAX_PENDING_KEYS = 25_000;

export class Analytics implements PlatformModule {
  readonly name = "analytics";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private flushPromise?: Promise<void>;
  private readonly pending = new Map<string, PendingAnalytics>();

  constructor(private readonly db: Database) {}

  async report(guildId: string, hours = 24): Promise<{
    hours: number;
    totals: Record<string, number>;
    points: Array<{ bucketStart: string; eventType: string; count: number }>;
  }> {
    await this.flush();
    const boundedHours = Math.min(Math.max(Math.trunc(hours), 1), 168);
    const result = await this.db.query<{
      event_type: string;
      bucket_start: string;
      count: string | number;
    }>(
      `SELECT event_type,bucket_start,count::text AS count
       FROM analytics_events
       WHERE guild_id=$1
         AND bucket_start >= now() - make_interval(hours => $2)
       ORDER BY bucket_start ASC,event_type ASC`,
      [guildId, boundedHours]
    );

    const totals: Record<string, number> = {};
    const points = result.rows.map((row) => {
      const count = Number(row.count);
      totals[row.event_type] = (totals[row.event_type] ?? 0) + count;
      return {
        bucketStart: row.bucket_start,
        eventType: row.event_type,
        count: Number.isFinite(count) ? count : 0
      };
    });

    return { hours: boundedHours, totals, points };
  }

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("member.add", (member) => this.count(member.guild.id, "member_join"));
    const b = context.events.on("member.remove", (member) => this.count(member.guild.id, "member_leave"));
    const c = context.events.on("message.create", (message) => message.guild ? this.count(message.guild.id, "message") : undefined);
    const d = context.events.on("voice.state", ({ oldState, newState }) => {
      const event = newState.channelId ? (oldState.channelId ? "voice_move" : "voice_join") : "voice_leave";
      void this.count(newState.guild.id, event);
    });
    const e = context.events.on("interaction.command", (interaction) => this.executeSlashCommand(interaction));
    this.unsubscribe = () => { a(); b(); c(); d(); e(); };

    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  private async count(guildId: string, eventType: string): Promise<void> {
    if (!await moduleEnabled(this.db, guildId, "analytics", false)) return;

    const now = Date.now();
    const bucketStart = new Date(Math.floor(now / 60_000) * 60_000);
    const key = `${guildId}:${eventType}:${bucketStart.getTime()}`;
    const existing = this.pending.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      this.pending.set(key, {
        guildId,
        eventType,
        bucketStart,
        count: 1
      });
    }

    if (this.pending.size >= FLUSH_BATCH_LIMIT) {
      void this.flush();
    } else if (this.pending.size > MAX_PENDING_KEYS) {
      logger.warn("Analytics pending buffer is unusually large", {
        pendingKeys: this.pending.size
      });
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (this.pending.size === 0) return;

    const batch = [...this.pending.values()];
    this.pending.clear();

    const work = (async (): Promise<void> => {
      try {
        const values: unknown[] = [];
        const placeholders = batch.map((item, index) => {
          const base = index * 4;
          values.push(item.guildId, item.eventType, item.bucketStart, item.count);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
        }).join(",");

        await this.db.query(
          `INSERT INTO analytics_events(guild_id,event_type,bucket_start,count)
           VALUES ${placeholders}
           ON CONFLICT(guild_id,event_type,bucket_start)
           DO UPDATE SET count=analytics_events.count+EXCLUDED.count`,
          values
        );
      } catch (error) {
        for (const item of batch) {
          const key = `${item.guildId}:${item.eventType}:${item.bucketStart.getTime()}`;
          const existing = this.pending.get(key);
          if (existing) existing.count += item.count;
          else this.pending.set(key, item);
        }
        logger.warn("Analytics batch flush failed; counts retained in memory", {
          batchKeys: batch.length,
          pendingKeys: this.pending.size,
          error: String(error)
        });
      }
    })();

    this.flushPromise = work.finally(() => {
      this.flushPromise = undefined;
      if (this.pending.size >= FLUSH_BATCH_LIMIT) {
        void this.flush();
      }
    });

    return this.flushPromise;
  }

  async executeSlashCommand(interaction: ChatInputCommandInteraction, commandName = interaction.commandName): Promise<void> {
    if (!interaction.inGuild() || commandName !== "analytics") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "analytics", false)) {
      await interaction.reply({ content: "Модуль Analytics выключен.", ephemeral: true });
      return;
    }
    await this.flush();

    const result = await this.db.query<{ event_type: string; total: string }>(
      `SELECT event_type,sum(count)::bigint AS total
       FROM analytics_events
       WHERE guild_id=$1 AND bucket_start >= now()-interval '24 hours'
       GROUP BY event_type ORDER BY total DESC`,
      [interaction.guild!.id]
    );
    const lines = result.rows.map((row) => `• ${row.event_type}: ${row.total}`);
    await interaction.reply({
      content: lines.length ? `📊 **Последние 24 часа**\\n${lines.join("\\n")}` : "Нет аналитических данных.",
      ephemeral: true
    });
  }
}
