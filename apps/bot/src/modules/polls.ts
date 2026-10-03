import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type PollStatus = "open" | "closed";
type PollRecord = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  question: string;
  options: string[];
  votes: Record<string, number[]>;
  multiple: boolean;
  endsAt: Date | null;
  status: PollStatus;
};

export class Polls implements PlatformModule {
  readonly name = "polls";
  private unsubscribe?: () => void;
  private client?: ModuleContext["client"];
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); };
    this.timer = setInterval(() => void this.closeExpired(), 30_000);
    this.timer.unref();
    await this.closeExpired();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.client = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "poll") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "polls", false)) {
      await interaction.reply({ content: "Модуль Polls выключен.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "create") {
      const question = interaction.options.getString("question", true).trim().slice(0, 300);
      const options = interaction.options.getString("options", true)
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 5);
      if (options.length < 2) {
        await interaction.reply({ content: "Нужно минимум два варианта, разделённых символом `|`.", ephemeral: true });
        return;
      }
      if (options.some((value) => value.length > 80)) {
        await interaction.reply({ content: "Каждый вариант должен быть не длиннее 80 символов.", ephemeral: true });
        return;
      }
      const multiple = interaction.options.getBoolean("multiple") ?? false;
      const minutes = interaction.options.getInteger("minutes") ?? 0;
      const endsAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
      if (!question) {
        await interaction.reply({ content: "Вопрос не может быть пустым.", ephemeral: true });
        return;
      }

      const created = await this.db.query<{ id: string }>(
        "INSERT INTO polls(guild_id,channel_id,creator_id,question,options,multiple,ends_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id",
        [interaction.guild!.id, interaction.channelId, interaction.user.id, question, JSON.stringify(options), multiple, endsAt]
      );
      const id = Number(created.rows[0]?.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error("poll_id_missing");

      const poll: PollRecord = {
        id, guildId: interaction.guild!.id, channelId: interaction.channelId, messageId: null,
        creatorId: interaction.user.id, question, options, votes: {}, multiple, endsAt, status: "open"
      };
      const message = await interaction.channel!.send({
        embeds: [this.embed(poll)],
        components: [this.row(id, options, false)]
      });
      await this.db.query("UPDATE polls SET message_id=$1 WHERE id=$2", [message.id, id]);
      await interaction.reply({ content: "📊 Опрос #" + id + " создан.", ephemeral: true });
      return;
    }

    const id = interaction.options.getInteger("id", true);
    const row = await this.getPoll(interaction.guild!.id, id);
    if (!row) {
      await interaction.reply({ content: "Опрос не найден.", ephemeral: true });
      return;
    }
    const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    if (!canManage && row.creatorId !== interaction.user.id) {
      await interaction.reply({ content: "Завершить этот опрос может его автор или Manage Server.", ephemeral: true });
      return;
    }
    const closed = await this.closePoll(interaction.guild!.id, id);
    await interaction.reply({
      content: closed ? "Опрос #" + id + " завершён." : "Опрос уже завершён.",
      ephemeral: true
    });
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:poll:") || !interaction.guild) return;
    const parts = interaction.customId.split(":");
    const id = Number(parts[2]);
    const optionIndex = Number(parts[3]);
    if (!Number.isSafeInteger(id) || !Number.isInteger(optionIndex)) return;

    const row = await this.getPoll(interaction.guild.id, id);
    if (!row || row.status !== "open") {
      await interaction.reply({ content: "Этот опрос уже завершён.", ephemeral: true });
      return;
    }
    if (row.endsAt && row.endsAt.getTime() <= Date.now()) {
      await this.closePoll(interaction.guild.id, id);
      await interaction.reply({ content: "Время опроса уже вышло.", ephemeral: true });
      return;
    }
    if (optionIndex < 0 || optionIndex >= row.options.length) return;

    const state = await this.db.transaction(async (client) => {
      const locked = await client.query<{
        options: string[];
        votes: Record<string, number[]>;
        multiple: boolean;
        status: PollStatus;
      }>("SELECT options,votes,multiple,status FROM polls WHERE id=$1 FOR UPDATE", [id]);
      const current = locked.rows[0];
      if (!current || current.status !== "open") return null;
      const votes = current.votes && typeof current.votes === "object" ? { ...current.votes } : {};
      const previous = Array.isArray(votes[interaction.user.id]) ? [...votes[interaction.user.id]!] : [];
      const next = current.multiple
        ? (previous.includes(optionIndex) ? previous.filter((value) => value !== optionIndex) : [...previous, optionIndex])
        : (previous.length === 1 && previous[0] === optionIndex ? [] : [optionIndex]);
      votes[interaction.user.id] = next;
      await client.query("UPDATE polls SET votes=$1::jsonb WHERE id=$2", [JSON.stringify(votes), id]);
      return { options: current.options, votes, multiple: current.multiple };
    });

    if (!state) {
      await interaction.reply({ content: "Опрос уже завершён.", ephemeral: true });
      return;
    }
    const poll: PollRecord = {
      ...row,
      options: state.options,
      votes: state.votes,
      multiple: state.multiple
    };
    await interaction.update({
      embeds: [this.embed(poll)],
      components: [this.row(id, poll.options, false)]
    });
  }

  private async getPoll(guildId: string, id: number): Promise<PollRecord | null> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      channel_id: string;
      message_id: string | null;
      creator_id: string;
      question: string;
      options: string[];
      votes: Record<string, number[]>;
      multiple: boolean;
      ends_at: Date | null;
      status: PollStatus;
    }>(
      "SELECT id,guild_id,channel_id,message_id,creator_id,question,options,votes,multiple,ends_at,status FROM polls WHERE id=$1 AND guild_id=$2",
      [id, guildId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id), guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id,
      creatorId: row.creator_id, question: row.question, options: Array.isArray(row.options) ? row.options : [],
      votes: row.votes && typeof row.votes === "object" ? row.votes : {}, multiple: row.multiple,
      endsAt: row.ends_at, status: row.status
    };
  }

  private async closeExpired(): Promise<void> {
    const result = await this.db.query<{ id: string; guild_id: string }>(
      "SELECT id,guild_id FROM polls WHERE status='open' AND ends_at IS NOT NULL AND ends_at <= now() ORDER BY ends_at LIMIT 25"
    );
    for (const row of result.rows) await this.closePoll(row.guild_id, Number(row.id)).catch(() => undefined);
  }

  private async closePoll(guildId: string, id: number): Promise<boolean> {
    const poll = await this.getPoll(guildId, id);
    if (!poll || poll.status !== "open") return false;
    const claimed = await this.db.query<{ id: string }>(
      "UPDATE polls SET status='closed',closed_at=now() WHERE id=$1 AND guild_id=$2 AND status='open' RETURNING id",
      [id, guildId]
    );
    if (!claimed.rows[0]) return false;
    poll.status = "closed";

    const channel = this.client?.channels.cache.get(poll.channelId);
    if (channel?.isTextBased() && "messages" in channel && poll.messageId) {
      const message = await channel.messages.fetch(poll.messageId).catch(() => null);
      if (message) {
        await message.edit({
          embeds: [this.embed(poll)],
          components: [this.row(poll.id, poll.options, true)]
        }).catch((error) => logger.warn("Poll close message update failed", { guildId, id, error: String(error) }));
      }
    }
    return true;
  }

  private embed(poll: PollRecord): EmbedBuilder {
    const counts = poll.options.map((_, index) => Object.values(poll.votes).reduce(
      (total, selections) => total + (Array.isArray(selections) && selections.includes(index) ? 1 : 0),
      0
    ));
    const lines = poll.options.map((option, index) =>
      "**" + (index + 1) + ".** " + option + " — **" + String(counts[index] ?? 0) + "**"
    );
    const voters = Object.values(poll.votes).filter((value) => Array.isArray(value) && value.length > 0).length;
    return new EmbedBuilder()
      .setTitle("📊 " + (poll.status === "open" ? "Опрос" : "Опрос завершён") + " #" + poll.id)
      .setDescription("**" + poll.question + "**\n\n" + lines.join("\n"))
      .addFields(
        { name: "Режим", value: poll.multiple ? "Можно выбрать несколько" : "Один вариант", inline: true },
        { name: "Проголосовали", value: String(voters), inline: true },
        { name: "Статус", value: poll.status === "open" ? (poll.endsAt ? "до <t:" + Math.floor(poll.endsAt.getTime() / 1000) + ":R>" : "без срока") : "закрыт", inline: true }
      )
      .setTimestamp();
  }

  private row(id: number, options: string[], disabled: boolean): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      options.slice(0, 5).map((option, index) =>
        new ButtonBuilder()
          .setCustomId("dsp:poll:" + id + ":" + index)
          .setLabel((index + 1) + ". " + option.slice(0, 70))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled)
      )
    );
  }
}
