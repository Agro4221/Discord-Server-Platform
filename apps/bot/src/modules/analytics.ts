import type { ChatInputCommandInteraction } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Analytics implements PlatformModule {
  readonly name = "analytics";
  private unsubscribe?: () => void;
  private client?: ModuleContext["client"];

  constructor(private readonly db: Database) {}

  async report(guildId: string, hours = 24): Promise<{
    hours: number;
    totals: Record<string, number>;
    points: Array<{ bucketStart: string; eventType: string; count: number }>;
    counters: {
      messageCount: number;
      memberJoins: number;
      memberLeaves: number;
      voiceJoins: number;
      voiceLeaves: number;
      voiceMoves: number;
    };
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

    const counters = await this.snapshot(guildId);
    return { hours: boundedHours, totals, points, counters };
  }

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const a = context.events.on("member.add", (member) => void this.count(member.guild.id, "member_join"));
    const b = context.events.on("member.remove", (member) => void this.count(member.guild.id, "member_leave"));
    const c = context.events.on("message.create", (message) => {
      if (message.guild) void this.count(message.guild.id, "message");
    });
    const d = context.events.on("voice.state", ({ oldState, newState }) => {
      const event = newState.channelId ? (oldState.channelId ? "voice_move" : "voice_join") : "voice_leave";
      void this.count(newState.guild.id, event);
    });
    const e = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.unsubscribe = () => { a(); b(); c(); d(); e(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.client = undefined;
  }

  private async count(guildId: string, eventType: string): Promise<void> {
    const counterColumns: Record<string, string> = {
      message: "message_count",
      member_join: "member_joins",
      member_leave: "member_leaves",
      voice_join: "voice_joins",
      voice_leave: "voice_leaves",
      voice_move: "voice_moves"
    };
    const column = counterColumns[eventType];
    if (column) {
      await this.db.query(
        "INSERT INTO server_counters(guild_id," + column + ") VALUES($1,1) " +
        "ON CONFLICT(guild_id) DO UPDATE SET " + column + "=server_counters." + column + "+1,updated_at=now()",
        [guildId]
      );
    }
    if (!await moduleEnabled(this.db, guildId, "analytics", false)) return;
    await this.db.query(
      `INSERT INTO analytics_events(guild_id,event_type,bucket_start,count)
       VALUES($1,$2,date_trunc('minute',now()),1)
       ON CONFLICT(guild_id,event_type,bucket_start)
       DO UPDATE SET count=analytics_events.count+1`,
      [guildId,eventType]
    );
  }

  async snapshot(guildId: string): Promise<{
    messageCount: number;
    memberJoins: number;
    memberLeaves: number;
    voiceJoins: number;
    voiceLeaves: number;
    voiceMoves: number;
  }> {
    const result = await this.db.query<{
      message_count: string;
      member_joins: string;
      member_leaves: string;
      voice_joins: string;
      voice_leaves: string;
      voice_moves: string;
    }>(
      "SELECT message_count,member_joins,member_leaves,voice_joins,voice_leaves,voice_moves FROM server_counters WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      messageCount: Number(row?.message_count ?? 0),
      memberJoins: Number(row?.member_joins ?? 0),
      memberLeaves: Number(row?.member_leaves ?? 0),
      voiceJoins: Number(row?.voice_joins ?? 0),
      voiceLeaves: Number(row?.voice_leaves ?? 0),
      voiceMoves: Number(row?.voice_moves ?? 0)
    };
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !["analytics","stats"].includes(interaction.commandName)) return;

    if (interaction.commandName === "stats") {
      const guild = interaction.guild!;
      const members = await guild.members.fetch().catch(() => guild.members.cache);
      const memberCount = guild.memberCount;
      const botCount = members.filter((member) => member.user.bot).size;
      const humanCount = Math.max(0, memberCount - botCount);
      const textChannels = guild.channels.cache.filter((channel) => channel.isTextBased() && channel.type === 0).size;
      const voiceChannels = guild.channels.cache.filter((channel) => channel.isVoiceBased() && channel.type === 2).size;
      const categories = guild.channels.cache.filter((channel) => channel.type === 4).size;
      const activeVoiceUsers = [...guild.voiceStates.cache.values()].filter((state) => Boolean(state.channelId)).length;
      const counters = await this.snapshot(guild.id);
      await interaction.reply({
        content: [
          "📊 **Статистика сервера**",
          "👥 Участников: **" + memberCount + "** (людей **" + humanCount + "** · ботов **" + botCount + "**)",
          "💬 Текстовых каналов: **" + textChannels + "**",
          "🔊 Voice-каналов: **" + voiceChannels + "**",
          "🗂️ Категорий: **" + categories + "**",
          "🎧 Сейчас в voice: **" + activeVoiceUsers + "**",
          "📈 Сообщений всего: **" + String(counters.messageCount) + "**",
          "↗️ Входов: **" + String(counters.memberJoins) + "** · выходов: **" + String(counters.memberLeaves) + "**",
          "🔊 Voice: **" + String(counters.voiceJoins) + "** входов · **" + String(counters.voiceLeaves) + "** выходов · **" + String(counters.voiceMoves) + "** перемещений"
        ].join("\n")
      });
      return;
    }

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
