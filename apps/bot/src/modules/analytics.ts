import type { ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Analytics implements PlatformModule {
  readonly name = "analytics";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async report(guildId: string, hours = 24): Promise<{
    hours: number;
    totals: Record<string, number>;
    points: Array<{ bucketStart: string; eventType: string; count: number }>;
  }> {
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
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async count(guildId: string, eventType: string): Promise<void> {
    if (!await moduleEnabled(this.db, guildId, "analytics", false)) return;
    await this.db.query(
      `INSERT INTO analytics_events(guild_id,event_type,bucket_start,count)
       VALUES($1,$2,date_trunc('minute',now()),1)
       ON CONFLICT(guild_id,event_type,bucket_start)
       DO UPDATE SET count=analytics_events.count+1`,
      [guildId,eventType]
    );
  }

  async executeSlashCommand(interaction: ChatInputCommandInteraction, commandName = interaction.commandName): Promise<void> {
    if (!interaction.inGuild() || commandName !== "analytics") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "analytics", false)) {
      await interaction.reply({ content: "Модуль Analytics выключен.", ephemeral: true });
      return;
    }
    const result = await this.db.query<{ event_type: string; total: string }>(
      `SELECT event_type,sum(count)::bigint AS total
       FROM analytics_events
       WHERE guild_id=$1 AND bucket_start >= now()-interval '24 hours'
       GROUP BY event_type ORDER BY total DESC`,
      [interaction.guild!.id]
    );
    const lines = result.rows.map((row) => `• ${row.event_type}: ${row.total}`);
    await interaction.reply({
      content: lines.length ? `📊 **Последние 24 часа**\n${lines.join("\n")}` : "Нет аналитических данных.",
      ephemeral: true
    });
  }
}
