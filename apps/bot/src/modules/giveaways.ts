import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import { randomInt } from "node:crypto";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class Giveaways implements PlatformModule {
  readonly name = "giveaways";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private client?: import("discord.js").Client;

  constructor(private readonly db: Database) {}

  async list(guildId: string): Promise<Array<{
    id: number;
    channelId: string;
    messageId: string | null;
    hostUserId: string;
    prize: string;
    winners: number;
    endsAt: string;
    status: string;
    selectedWinners: string[];
    createdAt: string;
    finishedAt: string | null;
  }>> {
    const result = await this.db.query<{
      id: string;
      channel_id: string;
      message_id: string | null;
      host_user_id: string;
      prize: string;
      winners: number;
      ends_at: string;
      status: string;
      selected_winners: unknown;
      created_at: string;
      finished_at: string | null;
    }>(
      "SELECT id,channel_id,message_id,host_user_id,prize,winners,ends_at,status,selected_winners,created_at,finished_at FROM giveaways WHERE guild_id=$1 ORDER BY id DESC LIMIT 100",
      [guildId]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      channelId: row.channel_id,
      messageId: row.message_id,
      hostUserId: row.host_user_id,
      prize: row.prize,
      winners: row.winners,
      endsAt: row.ends_at,
      status: row.status,
      selectedWinners: Array.isArray(row.selected_winners) ? row.selected_winners.filter((id): id is string => typeof id === "string") : [],
      createdAt: row.created_at,
      finishedAt: row.finished_at
    }));
  }

  async endGiveaway(id: number, guildId: string): Promise<{ id: number; channelId: string; winners: string[] } | null> {
    const result = await this.finish(id, guildId);
    if (!result || !this.client) return result;

    const channel = this.client.channels.cache.get(result.channelId);
    if (channel?.isTextBased() && "send" in channel) {
      const text = result.winners.length
        ? "🎉 Giveaway #" + result.id + " завершён! Победители: " + result.winners.map((userId) => "<@" + userId + ">").join(", ")
        : "Giveaway #" + result.id + " завершён. Участников не было.";
      await channel.send(text).catch(() => undefined);
    }

    return result;
  }

  async rerollGiveaway(id: number, guildId: string): Promise<string[] | null> {
    const claimed = await this.db.query<{ winners: number }>(
      "UPDATE giveaways SET status='rerolling' WHERE id=$1 AND guild_id=$2 AND status='finished' RETURNING winners",
      [id, guildId]
    );
    const row = claimed.rows[0];
    if (!row) return null;

    try {
      const entries = await this.db.query<{ user_id: string }>(
        "SELECT user_id FROM giveaway_entries WHERE giveaway_id=$1",
        [id]
      );
      const pool = entries.rows.map((entry) => entry.user_id);
      const winners: string[] = [];
      while (pool.length && winners.length < row.winners) {
        winners.push(pool.splice(randomInt(pool.length), 1)[0]!);
      }

      await this.db.query(
        "UPDATE giveaways SET status='finished',selected_winners=$1::jsonb,finished_at=now() WHERE id=$2 AND status='rerolling'",
        [JSON.stringify(winners), id]
      );

      return winners;
    } catch (error) {
      await this.db.query("UPDATE giveaways SET status='finished' WHERE id=$1 AND status='rerolling'", [id]);
      throw error;
    }
  }

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    this.timer = setInterval(() => void this.sweep(), 5_000);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "giveaway") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "giveaways", false)) {
      await interaction.reply({ content: "Модуль Giveaways выключен.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "end") {
      const id = interaction.options.getInteger("id", true);
      const result = await this.endGiveaway(id, interaction.guild!.id);
      const text = result
        ? (result.winners.length
          ? "🎉 Giveaway #" + id + " завершён. Победители: " + result.winners.map((userId) => "<@" + userId + ">").join(", ")
          : "Giveaway #" + id + " завершён, но участников не было.")
        : "Giveaway не найден или уже завершён.";
      await interaction.reply({ content: text, ephemeral: true });
      return;
    }
    if (subcommand === "reroll") {
      const id = interaction.options.getInteger("id", true);
      const winners = await this.rerollGiveaway(id, interaction.guild!.id);
      await interaction.reply({
        content: winners === null
          ? "Reroll доступен только для завершённого giveaway."
          : (winners.length ? "🔄 Reroll #" + id + ": " + winners.map((userId) => "<@" + userId + ">").join(", ") : "Нет участников для reroll."),
        ephemeral: true
      });
      return;
    }
    const minutes = interaction.options.getInteger("minutes", true);
    const winners = interaction.options.getInteger("winners") ?? 1;
    const prize = interaction.options.getString("prize", true);
    const endsAt = new Date(Date.now() + minutes * 60_000);

    const created = await this.db.query<{ id: string }>(
      `INSERT INTO giveaways(guild_id,channel_id,host_user_id,prize,winners,ends_at,status)
       VALUES($1,$2,$3,$4,$5,$6,'running') RETURNING id`,
      [interaction.guild!.id, interaction.channelId, interaction.user.id, prize, winners, endsAt]
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error("giveaway id missing");

    const message = await interaction.channel!.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎉 Giveaway")
          .setDescription(`**Приз:** ${prize}\n**Победителей:** ${winners}\n**До:** <t:${Math.floor(endsAt.getTime()/1000)}:R>`)
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`dsp:giveaway:enter:${id}`)
            .setLabel("Участвовать")
            .setStyle(ButtonStyle.Success)
        )
      ]
    });

    await this.db.query("UPDATE giveaways SET message_id=$1 WHERE id=$2", [message.id, id]);
    await interaction.reply({ content: "Giveaway создан.", ephemeral: true });
  }

  private async finish(id: number, guildId: string): Promise<{ id: number; channelId: string; winners: string[] } | null> {
    const claimed = await this.db.query<{ id: string; channel_id: string; winners: number }>(
      "UPDATE giveaways SET status='finishing' WHERE id=$1 AND guild_id=$2 AND status='running' RETURNING id,channel_id,winners",
      [id, guildId]
    );
    const row = claimed.rows[0];
    if (!row) return null;

    try {
      const entries = await this.db.query<{ user_id: string }>(
        "SELECT user_id FROM giveaway_entries WHERE giveaway_id=$1",
        [id]
      );
      const pool = entries.rows.map((entry) => entry.user_id);
      const winners: string[] = [];
      while (pool.length && winners.length < row.winners) {
        winners.push(pool.splice(randomInt(pool.length), 1)[0]!);
      }
      await this.db.query(
        "UPDATE giveaways SET status='finished',selected_winners=$1::jsonb,finished_at=now() WHERE id=$2 AND status='finishing'",
        [JSON.stringify(winners), id]
      );
      return { id, channelId: row.channel_id, winners };
    } catch (error) {
      await this.db.query("UPDATE giveaways SET status='running' WHERE id=$1 AND status='finishing'", [id]);
      throw error;
    }
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:giveaway:") || !interaction.guild!) return;
    const [, , action, rawId] = interaction.customId.split(":");
    const id = Number(rawId);
    if (action !== "enter" || !Number.isSafeInteger(id)) return;

    const result = await this.db.query<{ status: string }>(
      "SELECT status FROM giveaways WHERE id=$1 AND guild_id=$2",
      [id, interaction.guild!.id]
    );
    if (result.rows[0]?.status !== "running") {
      await interaction.reply({ content: "Этот giveaway уже завершён.", ephemeral: true });
      return;
    }

    await this.db.query(
      "INSERT INTO giveaway_entries(giveaway_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, interaction.user.id]
    );
    await interaction.reply({ content: "Ты участвуешь! 🎉", ephemeral: true });
  }

  private async sweep(): Promise<void> {
    const expired = await this.db.query<{ id: string; guild_id: string }>(
      "SELECT id,guild_id FROM giveaways WHERE status='running' AND ends_at <= now() ORDER BY ends_at LIMIT 20"
    );

    for (const giveaway of expired.rows) {
      const result = await this.finish(Number(giveaway.id), giveaway.guild_id);
      if (!result || !this.client) continue;

      const channel = this.client.channels.cache.get(result.channelId);
      if (channel?.isTextBased() && "send" in channel) {
        const text = result.winners.length
          ? "🎉 Giveaway #" + result.id + " завершён! Победители: " + result.winners.map((userId) => "<@" + userId + ">").join(", ")
          : "Giveaway #" + result.id + " завершён. Участников не было.";
        await channel.send(text).catch(() => undefined);
      }
    }
  }

}

function loggerSafe(message: string): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "INFO", message }));
}
