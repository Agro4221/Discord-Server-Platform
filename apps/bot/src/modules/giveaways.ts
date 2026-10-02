import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Message
} from "discord.js";
import { randomInt } from "node:crypto";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export class Giveaways implements PlatformModule {
  readonly name = "giveaways";
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private client?: import("discord.js").Client;
  private events?: import("../events.js").PlatformEventBus;
  private identityId = "primary";

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

  async endGiveaway(id: number, guildId: string): Promise<{ id: number; channelId: string; messageId: string | null; winners: string[] } | null> {
    const result = await this.finish(id, guildId);
    if (!result || !this.client) return result;

    const channel = this.client.channels.cache.get(result.channelId);
    const text = result.winners.length
      ? "🎉 Giveaway #" + result.id + " завершён! Победители: " + result.winners.map((userId) => "<@" + userId + ">").join(", ")
      : "Giveaway #" + result.id + " завершён. Участников не было.";

    if (channel?.isTextBased() && "messages" in channel && result.messageId) {
      const original = await channel.messages.fetch(result.messageId).catch((error) => {
        logger.warn("Giveaway original message fetch failed", {
          guildId,
          giveawayId: result.id,
          messageId: result.messageId,
          error: String(error)
        });
        return null;
      });
      if (original) {
        await original.edit({
          content: text,
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId("dsp:giveaway:finished:" + result.id)
                .setLabel("Завершено")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
            )
          ]
        }).catch((error) => {
          logger.warn("Giveaway original message update failed", {
            guildId,
            giveawayId: result.id,
            messageId: result.messageId,
            error: String(error)
          });
        });
      }
    }

    if (channel?.isTextBased() && "send" in channel) {
      await channel.send(text).catch((error) => {
        logger.warn("Giveaway result message failed", {
          guildId,
          giveawayId: result.id,
          channelId: result.channelId,
          error: String(error)
        });
      });
    }

    return result;
  }

  async rerollGiveaway(id: number, guildId: string): Promise<string[] | null> {
    const claimed = await this.db.query<{ winners: number }>(
      "UPDATE giveaways SET status='rerolling',updated_at=now() WHERE id=$1 AND guild_id=$2 AND status='finished' RETURNING winners",
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
        "UPDATE giveaways SET status='finished',selected_winners=$1::jsonb,finished_at=now(),updated_at=now() WHERE id=$2 AND status='rerolling'",
        [JSON.stringify(winners), id]
      );

      return winners;
    } catch (error) {
      await this.db.query("UPDATE giveaways SET status='finished',updated_at=now() WHERE id=$1 AND status='rerolling'", [id]);
      logger.error("Giveaway reroll failed", { guildId, giveawayId: id, error: String(error) });
      throw error;
    }
  }

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    await this.recoverStaleStates();
    this.identityId = context.identityId;
    this.events = context.events;
    const commandUnsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const interactionUnsubscribe = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { commandUnsubscribe(); interactionUnsubscribe(); };
    this.timer = setInterval(() => void this.sweep(), 5_000);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.client = undefined;
    this.events = undefined;
  }

  async handlePrefixCommand(message: Message, commandName: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot || commandName !== "giveaway") return false;
    if (!await moduleEnabled(this.db, message.guild.id, "giveaways", false)) {
      await message.reply("Модуль Giveaways выключен.");
      return true;
    }
    if (!message.member?.permissions.has("ManageGuild")) {
      await message.reply("Нужны права Manage Server.");
      return true;
    }

    const durationMinutes = parseGiveawayMinutes(args[0] ?? "");
    const prize = args.slice(1).join(" ").trim();
    if (!durationMinutes || !prize) {
      await message.reply("Использование: !giveaway 60m <приз>");
      return true;
    }

    const endsAt = new Date(Date.now() + durationMinutes * 60_000);
    const created = await this.db.query<{ id: string }>(
      `INSERT INTO giveaways(guild_id,channel_id,host_user_id,prize,winners,ends_at,status)
       VALUES($1,$2,$3,$4,1,$5,'running') RETURNING id`,
      [message.guild.id,message.channelId,message.author.id,prize,endsAt]
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error("giveaway id missing");

    try {
      if (!message.channel.isTextBased() || !("send" in message.channel)) {
        throw new Error("giveaway requires a text channel");
      }
      const sent = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎉 Giveaway")
            .setDescription(`**Приз:** ${prize}\n**Победителей:** 1\n**До:** <t:${Math.floor(endsAt.getTime()/1000)}:R>`)
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`dsp:giveaway:enter:${id}`).setLabel("Участвовать").setStyle(ButtonStyle.Success)
          )
        ]
      });
      await this.db.query("UPDATE giveaways SET message_id=$1 WHERE id=$2 AND guild_id=$3", [sent.id,id,message.guild.id]);
      await message.reply({ content: "Giveaway создан: #" + id });
    } catch (error) {
      await this.db.query("DELETE FROM giveaways WHERE id=$1 AND guild_id=$2", [id,message.guild.id]).catch(() => undefined);
      throw error;
    }
    return true;
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

    let message: Message | undefined;
    let publishedMessageId: string | undefined;
    try {
      message = await interaction.channel!.send({
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

      if (!message) throw new Error("giveaway_message_missing");
      publishedMessageId = message.id;
      await this.db.query("UPDATE giveaways SET message_id=$1 WHERE id=$2", [publishedMessageId, id]);
    } catch (error) {
      if (message) {
        const rollbackMessageId = publishedMessageId;
        await message.delete().catch((deleteError) => {
          logger.warn("Giveaway rollback message delete failed", {
            guildId: interaction.guild!.id,
            giveawayId: id,
            messageId: rollbackMessageId,
            error: String(deleteError)
          });
        });
      }
      await this.db.query("DELETE FROM giveaways WHERE id=$1 AND guild_id=$2", [id, interaction.guild!.id])
        .catch((cleanupError) => {
          logger.error("Giveaway rollback database cleanup failed", {
            guildId: interaction.guild!.id,
            giveawayId: id,
            error: String(cleanupError)
          });
        });
      logger.error("Giveaway publication failed and was rolled back", {
        guildId: interaction.guild!.id,
        giveawayId: id,
        error: String(error)
      });
      throw error;
    }

    try {
      await interaction.reply({ content: "Giveaway создан.", ephemeral: true });
    } catch (error) {
      logger.warn("Giveaway success response failed", {
        guildId: interaction.guild!.id,
        giveawayId: id,
        error: String(error)
      });
    }
  }

  private async finish(id: number, guildId: string): Promise<{ id: number; channelId: string; messageId: string | null; winners: string[] } | null> {
    const claimed = await this.db.query<{ id: string; channel_id: string; message_id: string | null; winners: number }>(
      "UPDATE giveaways SET status='finishing',updated_at=now() WHERE id=$1 AND guild_id=$2 AND status='running' RETURNING id,channel_id,message_id,winners",
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
        "UPDATE giveaways SET status='finished',selected_winners=$1::jsonb,finished_at=now(),updated_at=now() WHERE id=$2 AND status='finishing'",
        [JSON.stringify(winners), id]
      );
      await this.events?.emit("giveaway.end", {
        guildId,
        giveawayId: id,
        winners
      });
      return { id, channelId: row.channel_id, messageId: row.message_id, winners };
    } catch (error) {
      await this.db.query("UPDATE giveaways SET status='running',updated_at=now() WHERE id=$1 AND status='finishing'", [id]);
      logger.error("Giveaway finishing failed and was reverted to running", {
        guildId,
        giveawayId: id,
        error: String(error)
      });
      throw error;
    }
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:giveaway:") || !interaction.guild) return;
    const [, , action, rawId] = interaction.customId.split(":");
    const id = Number(rawId);
    if (action !== "enter" || !Number.isSafeInteger(id)) return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "giveaways", false)) {
      await interaction.reply({ content: "Модуль Giveaways выключен.", ephemeral: true });
      return;
    }

    const result = await this.db.query<{ giveaway_id: string }>(
      "INSERT INTO giveaway_entries(giveaway_id,user_id) SELECT $1,$2 WHERE EXISTS (SELECT 1 FROM giveaways WHERE id=$1 AND guild_id=$3 AND status='running') ON CONFLICT DO NOTHING RETURNING giveaway_id",
      [id, interaction.user.id, interaction.guild.id]
    );
    if (!result.rows[0]) {
      await interaction.reply({ content: "Этот giveaway уже завершён или не найден.", ephemeral: true });
      return;
    }

    await interaction.reply({ content: "Ты участвуешь! 🎉", ephemeral: true });
  }

  private async recoverStaleStates(): Promise<void> {
    const finishing = await this.db.query(
      "UPDATE giveaways SET status='running',updated_at=now() WHERE status='finishing' AND updated_at < now()-interval '10 minutes'"
    );
    const rerolling = await this.db.query(
      "UPDATE giveaways SET status='finished',updated_at=now() WHERE status='rerolling' AND updated_at < now()-interval '10 minutes'"
    );
    if (finishing.rowCount || rerolling.rowCount) {
      logger.warn("Recovered stale Giveaway states", {
        finishing: finishing.rowCount,
        rerolling: rerolling.rowCount
      });
    }
  }

  private async sweep(): Promise<void> {
    try {
      const expired = await this.db.query<{ id: string; guild_id: string }>(
      "SELECT g.id,g.guild_id FROM giveaways g INNER JOIN guild_bot_assignments ga ON ga.guild_id=g.guild_id LEFT JOIN bot_heartbeats bh ON bh.bot_identity_id=ga.bot_identity_id WHERE (ga.bot_identity_id=$1 OR ($1='primary' AND ga.bot_identity_id <> 'primary' AND bh.last_seen_at < now()-interval '90 seconds')) AND g.status='running' AND g.ends_at <= now() ORDER BY g.ends_at LIMIT 20",
      [this.identityId]
    );

      for (const giveaway of expired.rows) {
        await this.endGiveaway(Number(giveaway.id), giveaway.guild_id).catch((error) => {
          logger.error("Giveaway scheduled finish failed", {
            identityId: this.identityId,
            guildId: giveaway.guild_id,
            giveawayId: giveaway.id,
            error: String(error)
          });
        });
      }
    } catch (error) {
      logger.error("Giveaway worker cycle failed", { identityId: this.identityId, error: String(error) });
    }
  }

}

function parseGiveawayMinutes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!match) return null;
  const n = Number(match[1]);
  const factor = match[2] === "w" ? 10080 : match[2] === "d" ? 1440 : match[2] === "h" ? 60 : 1;
  const minutes = n * factor;
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 10080 ? minutes : null;
}
