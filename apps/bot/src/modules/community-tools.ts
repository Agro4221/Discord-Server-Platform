import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  Message
} from "discord.js";
import type { AuditLog } from "../audit.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type PollRecord = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  question: string;
  options: string[];
  endsAt: Date;
  closed: boolean;
};

type SuggestionStatus = "pending" | "approved" | "denied";

type SuggestionRecord = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  userId: string;
  content: string;
  status: SuggestionStatus;
};

const SUPPORTED = new Set([
  "poll",
  "suggest",
  "sticky",
  "8ball",
  "choose",
  "roll"
]);

const POLL_ICONS = ["A", "B", "C", "D", "E"] as const;

export class CommunityTools implements PlatformModule {
  readonly name = "community-tools";

  private client?: Client;
  private auditLog?: AuditLog;
  private unsubscribeInteraction?: () => void;
  private unsubscribeCommand?: () => void;
  private unsubscribeMessage?: () => void;
  private pollWorker?: NodeJS.Timeout;
  private readonly pollTimers = new Map<number, NodeJS.Timeout>();
  private readonly stickyLocks = new Set<string>();

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    this.auditLog = context.auditLog;

    this.unsubscribeInteraction = context.events.on(
      "interaction",
      (interaction) => {
        if (interaction.isButton()) void this.handleInteraction(interaction);
      }
    );
    this.unsubscribeCommand = context.events.on(
      "interaction.command",
      (interaction) => { void this.handleCommand(interaction); }
    );
    this.unsubscribeMessage = context.events.on(
      "message.create",
      (message) => { void this.handleMessage(message); }
    );

    const active = await this.db.query<{ id: string }>(
      "SELECT id FROM polls WHERE closed=false"
    );
    for (const row of active.rows) {
      this.schedulePollClose(Number(row.id));
    }

    this.pollWorker = setInterval(() => {
      void this.closeDuePolls();
    }, 15_000);
    this.pollWorker.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribeInteraction?.();
    this.unsubscribeCommand?.();
    this.unsubscribeMessage?.();
    this.unsubscribeInteraction = undefined;
    this.unsubscribeCommand = undefined;
    this.unsubscribeMessage = undefined;

    if (this.pollWorker) clearInterval(this.pollWorker);
    this.pollWorker = undefined;

    for (const timer of this.pollTimers.values()) clearTimeout(timer);
    this.pollTimers.clear();
    this.stickyLocks.clear();
    this.client = undefined;
    this.auditLog = undefined;
  }

  async handlePrefixCommand(
    message: Message,
    commandName: string,
    args: string[]
  ): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;
    if (!SUPPORTED.has(commandName)) return false;

    if (!await moduleEnabled(
      this.db,
      message.guild.id,
      "community-tools",
      true
    )) {
      await message.reply("Модуль Community Tools выключен.");
      return true;
    }

    if (commandName === "poll") {
      await this.createPrefixPoll(message, args);
      return true;
    }

    if (commandName === "suggest") {
      await this.createSuggestion(message, args.join(" "));
      return true;
    }

    if (commandName === "sticky") {
      await this.handleStickyPrefix(message, args);
      return true;
    }

    if (commandName === "8ball") {
      await message.reply(random8BallAnswer());
      return true;
    }

    if (commandName === "choose") {
      await message.reply(chooseFromOptions(args.join(" ")));
      return true;
    }

    if (commandName === "roll") {
      await message.reply(formatDiceRoll(args[0] || "1d20"));
      return true;
    }

    return false;
  }

  private async handleInteraction(
    interaction: import("discord.js").Interaction
  ): Promise<void> {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith("poll:")) {
      await this.handlePollVote(interaction);
      return;
    }

    if (interaction.customId.startsWith("suggest:")) {
      await this.handleSuggestionAction(interaction);
    }
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.inGuild()) return;
    if (!SUPPORTED.has(interaction.commandName)) return;

    if (!await moduleEnabled(
      this.db,
      interaction.guildId!,
      "community-tools",
      true
    )) {
      await interaction.reply({
        content: "Модуль Community Tools выключен.",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "poll") {
      await this.createSlashPoll(interaction);
      return;
    }

    if (interaction.commandName === "suggest") {
      await this.createSuggestion(
        interaction,
        interaction.options.getString("text", true)
      );
      return;
    }

    if (interaction.commandName === "sticky") {
      await this.handleStickySlash(interaction);
      return;
    }

    if (interaction.commandName === "8ball") {
      await interaction.reply(random8BallAnswer());
      return;
    }

    if (interaction.commandName === "choose") {
      await interaction.reply(
        chooseFromOptions(
          interaction.options.getString("options", true)
        )
      );
      return;
    }

    if (interaction.commandName === "roll") {
      await interaction.reply(
        formatDiceRoll(
          interaction.options.getString("dice") || "1d20"
        )
      );
    }
  }

  private async handlePollVote(
    interaction: ButtonInteraction
  ): Promise<void> {
    const parts = interaction.customId.split(":");
    const pollId = Number(parts[1]);
    const optionIndex = Number(parts[2]);

    if (
      parts.length !== 3 ||
      !Number.isSafeInteger(pollId) ||
      !Number.isInteger(optionIndex)
    ) {
      return;
    }

    const poll = await this.getPoll(pollId);

    if (
      !poll ||
      poll.closed ||
      poll.endsAt.getTime() <= Date.now()
    ) {
      await interaction.reply({
        content: "Этот опрос уже завершён.",
        ephemeral: true
      });
      return;
    }

    if (poll.guildId !== interaction.guildId) return;

    const option = poll.options[optionIndex];
    if (!option) return;

    await this.db.query(
      "INSERT INTO poll_votes(poll_id,user_id,option_index,created_at) " +
      "VALUES($1,$2,$3,now()) " +
      "ON CONFLICT(poll_id,user_id) " +
      "DO UPDATE SET option_index=EXCLUDED.option_index,created_at=now()",
      [pollId, interaction.user.id, optionIndex]
    );

    await this.audit({
      guildId: poll.guildId,
      actorUserId: interaction.user.id,
      source: "discord",
      action: "poll.vote",
      targetType: "poll",
      targetId: String(pollId),
      metadata: { optionIndex }
    });

    await interaction.reply({
      content: "✅ Голос записан за **" + option + "**.",
      ephemeral: true
    });

    await this.refreshPollMessage(pollId);
  }

  private async handleSuggestionAction(
    interaction: ButtonInteraction
  ): Promise<void> {
    if (!interaction.inGuild()) return;

    const allowed =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);

    if (!allowed) {
      await interaction.reply({
        content:
          "Для обработки предложений нужны права Manage Server или Manage Messages.",
        ephemeral: true
      });
      return;
    }

    const parts = interaction.customId.split(":");
    const action = parts[1];
    const id = Number(parts[2]);

    if (
      !["approve", "deny"].includes(action || "") ||
      !Number.isSafeInteger(id)
    ) {
      return;
    }

    const suggestion = await this.getSuggestion(id);

    if (!suggestion || suggestion.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "Предложение не найдено.",
        ephemeral: true
      });
      return;
    }

    if (suggestion.status !== "pending") {
      await interaction.reply({
        content: "Это предложение уже обработано.",
        ephemeral: true
      });
      return;
    }

    const status: SuggestionStatus =
      action === "approve" ? "approved" : "denied";

    const result = await this.db.query(
      "UPDATE suggestions SET status=$2,updated_at=now() " +
      "WHERE id=$1 AND status='pending'",
      [id, status]
    );

    if (result.rowCount !== 1) {
      await interaction.reply({
        content: "Не удалось изменить статус предложения.",
        ephemeral: true
      });
      return;
    }

    await this.audit({
      guildId: suggestion.guildId,
      actorUserId: interaction.user.id,
      source: "discord",
      action: "suggestion." + status,
      targetType: "suggestion",
      targetId: String(id),
      metadata: { authorUserId: suggestion.userId }
    });

    await interaction.reply({
      content:
        status === "approved"
          ? "✅ Предложение одобрено."
          : "❌ Предложение отклонено.",
      ephemeral: true
    });

    await this.refreshSuggestionMessage(id);
  }

  private async createSlashPoll(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const question = interaction.options.getString("question", true);
    const options = [
      interaction.options.getString("option1", true),
      interaction.options.getString("option2", true),
      interaction.options.getString("option3"),
      interaction.options.getString("option4"),
      interaction.options.getString("option5")
    ].filter((value): value is string => Boolean(value?.trim()));

    const poll = await this.createPoll(
      interaction.guildId!,
      interaction.channelId,
      question,
      options,
      interaction.options.getInteger("minutes") || 60
    );

    await this.publishPoll(poll, interaction);
  }

  private async createPrefixPoll(
    message: Message,
    args: string[]
  ): Promise<void> {
    const parts = parsePipeInput(args.join(" "));

    if (parts.length < 3 || parts.length > 6) {
      await message.reply(
        "Формат: '!poll Вопрос | Вариант 1 | Вариант 2 | ...' (2-5 вариантов)."
      );
      return;
    }

    const poll = await this.createPoll(
      message.guild!.id,
      message.channelId,
      parts[0] || "",
      parts.slice(1),
      60
    );

    await this.publishPoll(poll, message);
  }

  private async createPoll(
    guildId: string,
    channelId: string,
    question: string,
    options: string[],
    durationMinutes: number
  ): Promise<PollRecord> {
    const normalizedQuestion = question.trim().slice(0, 300);
    const normalizedOptions = options
      .map((option) => option.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 5);

    if (!normalizedQuestion || normalizedOptions.length < 2) {
      throw new Error(
        "poll_requires_question_and_two_options"
      );
    }

    const minutes = Math.min(
      Math.max(Math.floor(durationMinutes), 1),
      10080
    );

    const endsAt = new Date(
      Date.now() + minutes * 60_000
    );

    const result = await this.db.query<{ id: string }>(
      "INSERT INTO polls(guild_id,channel_id,question,options,ends_at,closed) " +
      "VALUES($1,$2,$3,$4::jsonb,$5,false) RETURNING id",
      [
        guildId,
        channelId,
        normalizedQuestion,
        JSON.stringify(normalizedOptions),
        endsAt
      ]
    );

    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("poll_create_failed");
    }

    const poll = await this.getPoll(id);
    if (!poll) throw new Error("poll_create_failed");

    this.schedulePollClose(id);
    return poll;
  }

  private async publishPoll(
    poll: PollRecord,
    target: Message | ChatInputCommandInteraction
  ): Promise<void> {
    const payload = {
      embeds: [this.buildPollEmbed(poll, new Map())],
      components: [this.buildPollButtons(poll)]
    };

    let message: Message;

    try {
      if (target instanceof Message) {
        message = await target.reply(payload);
      } else {
        await target.reply(payload);
        message = await target.fetchReply();
      }
    } catch (error) {
      await this.db.query(
        "DELETE FROM polls WHERE id=$1",
        [poll.id]
      );

      const timer = this.pollTimers.get(poll.id);
      if (timer) clearTimeout(timer);
      this.pollTimers.delete(poll.id);
      throw error;
    }

    await this.db.query(
      "UPDATE polls SET message_id=$2 WHERE id=$1",
      [poll.id, message.id]
    );

    await this.refreshPollMessage(poll.id, poll);
  }

  private buildPollEmbed(
    poll: PollRecord,
    counts: Map<number, number>
  ): EmbedBuilder {
    const totalVotes = Array.from(
      counts.values()
    ).reduce(
      (sum, value) => sum + value,
      0
    );

    const lines = poll.options.map((option, index) => {
      const count = counts.get(index) || 0;
      const percent = totalVotes
        ? Math.round((count / totalVotes) * 100)
        : 0;

      return (
        POLL_ICONS[index] +
        " **" +
        option +
        "** — " +
        count +
        " (" +
        percent +
        "%)"
      );
    });

    return new EmbedBuilder()
      .setTitle("📊 " + poll.question)
      .setDescription(lines.join("\n"))
      .addFields({
        name: "Опрос",
        value: poll.closed
          ? "Завершён"
          : "До <t:" +
            Math.floor(
              poll.endsAt.getTime() / 1000
            ) +
            ":R>"
      })
      .setFooter({
        text:
          "Poll #" +
          poll.id +
          " · " +
          totalVotes +
          " голосов"
      });
  }

  private buildPollButtons(
    poll: PollRecord
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    poll.options.forEach((option, index) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            "poll:" +
            poll.id +
            ":" +
            index
          )
          .setLabel(
            POLL_ICONS[index] +
            " " +
            option.slice(0, 70)
          )
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(poll.closed)
      );
    });

    return row;
  }

  private async refreshPollMessage(
    pollId: number,
    poll?: PollRecord
  ): Promise<void> {
    const current = poll || await this.getPoll(pollId);
    if (!current?.messageId || !this.client) return;

    const result = await this.db.query<{
      option_index: number;
      count: string;
    }>(
      "SELECT option_index,count(*)::text AS count " +
      "FROM poll_votes WHERE poll_id=$1 GROUP BY option_index",
      [pollId]
    );

    const counts = new Map(
      result.rows.map((row) => [
        Number(row.option_index),
        Number(row.count)
      ])
    );

    const channel = this.client.channels.cache.get(
      current.channelId
    );

    if (
      !channel ||
      !channel.isTextBased() ||
      !("messages" in channel)
    ) {
      return;
    }

    const message = await channel.messages
      .fetch(current.messageId)
      .catch(() => null);

    if (!message) return;

    await message.edit({
      embeds: [this.buildPollEmbed(current, counts)],
      components: [this.buildPollButtons(current)]
    }).catch(() => undefined);
  }

  private async closeDuePolls(): Promise<void> {
    const result = await this.db.query<{ id: string }>(
      "SELECT id FROM polls " +
      "WHERE closed=false AND ends_at<=now() LIMIT 100"
    );

    for (const row of result.rows) {
      await this.closePoll(Number(row.id));
    }
  }

  private schedulePollClose(id: number): void {
    const current = this.pollTimers.get(id);
    if (current) clearTimeout(current);
    this.pollTimers.delete(id);

    void this.getPoll(id).then((poll) => {
      if (!poll || poll.closed) return;

      const remaining =
        poll.endsAt.getTime() - Date.now();

      const delay = Math.min(
        Math.max(remaining, 1000),
        2_147_000_000
      );

      const timer = setTimeout(() => {
        this.pollTimers.delete(id);

        if (remaining > 2_147_000_000) {
          this.schedulePollClose(id);
        } else {
          void this.closePoll(id);
        }
      }, delay);

      timer.unref();
      this.pollTimers.set(id, timer);
    });
  }

  private async closePoll(id: number): Promise<void> {
    const poll = await this.getPoll(id);
    if (!poll) return;

    const result = await this.db.query(
      "UPDATE polls SET closed=true,closed_at=now() " +
      "WHERE id=$1 AND closed=false",
      [id]
    );

    this.pollTimers.delete(id);
    if (result.rowCount !== 1) return;

    await this.audit({
      guildId: poll.guildId,
      source: "system",
      action: "poll.closed",
      targetType: "poll",
      targetId: String(id)
    });

    await this.refreshPollMessage(id);
  }

  private async createSuggestion(
    target: Message | ChatInputCommandInteraction,
    content: string
  ): Promise<void> {
    const text = content.trim().slice(0, 1500);

    if (!text) {
      if (target instanceof Message) {
        await target.reply("Напиши текст предложения.");
      } else {
        await target.reply({
          content: "Напиши текст предложения.",
          ephemeral: true
        });
      }
      return;
    }

    const guildId = target.guildId;
    const channelId = target.channelId;
    const userId =
      target instanceof Message
        ? target.author.id
        : target.user.id;

    if (!guildId || !channelId) return;

    const result = await this.db.query<{ id: string }>(
      "INSERT INTO suggestions(guild_id,channel_id,user_id,content,status) " +
      "VALUES($1,$2,$3,$4,'pending') RETURNING id",
      [guildId, channelId, userId, text]
    );

    const id = Number(result.rows[0]?.id);
    const suggestion = await this.getSuggestion(id);

    if (!suggestion) {
      throw new Error("suggestion_create_failed");
    }

    const payload = {
      embeds: [this.buildSuggestionEmbed(suggestion)],
      components: [
        this.buildSuggestionButtons(suggestion)
      ]
    };

    let message: Message;

    try {
      if (target instanceof Message) {
        message = await target.reply(payload);
      } else {
        await target.reply(payload);
        message = await target.fetchReply();
      }
    } catch (error) {
      await this.db.query(
        "DELETE FROM suggestions WHERE id=$1",
        [id]
      );
      throw error;
    }

    await this.db.query(
      "UPDATE suggestions SET message_id=$2 WHERE id=$1",
      [id, message.id]
    );

    await this.audit({
      guildId,
      actorUserId: userId,
      source: "discord",
      action: "suggestion.created",
      targetType: "suggestion",
      targetId: String(id)
    });
  }

  private buildSuggestionEmbed(
    suggestion: SuggestionRecord
  ): EmbedBuilder {
    const color =
      suggestion.status === "approved"
        ? 0x2ecc71
        : suggestion.status === "denied"
          ? 0xe74c3c
          : 0xf1c40f;

    return new EmbedBuilder()
      .setTitle(
        "💡 Предложение #" +
        suggestion.id
      )
      .setDescription(suggestion.content)
      .addFields(
        {
          name: "Автор",
          value:
            "<@" +
            suggestion.userId +
            ">",
          inline: true
        },
        {
          name: "Статус",
          value: suggestion.status,
          inline: true
        }
      )
      .setColor(color);
  }

  private buildSuggestionButtons(
    suggestion: SuggestionRecord
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          "suggest:approve:" +
          suggestion.id
        )
        .setLabel("Одобрить")
        .setStyle(ButtonStyle.Success)
        .setDisabled(suggestion.status !== "pending"),
      new ButtonBuilder()
        .setCustomId(
          "suggest:deny:" +
          suggestion.id
        )
        .setLabel("Отклонить")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(suggestion.status !== "pending")
    );
  }

  private async refreshSuggestionMessage(
    id: number
  ): Promise<void> {
    const suggestion = await this.getSuggestion(id);
    if (!suggestion?.messageId || !this.client) return;

    const channel = this.client.channels.cache.get(
      suggestion.channelId
    );

    if (
      !channel ||
      !channel.isTextBased() ||
      !("messages" in channel)
    ) {
      return;
    }

    const message = await channel.messages
      .fetch(suggestion.messageId)
      .catch(() => null);

    if (!message) return;

    await message.edit({
      embeds: [
        this.buildSuggestionEmbed(suggestion)
      ],
      components: [
        this.buildSuggestionButtons(suggestion)
      ]
    }).catch(() => undefined);
  }

  private async handleStickyPrefix(
    message: Message,
    args: string[]
  ): Promise<void> {
    if (!message.member?.permissions.has(
      PermissionFlagsBits.ManageMessages
    )) {
      await message.reply(
        "Нужны права Manage Messages."
      );
      return;
    }

    const subcommand =
      (args.shift() || "").toLowerCase();

    if (
      subcommand === "clear" ||
      subcommand === "off"
    ) {
      await this.clearSticky(
        message.guild!.id,
        message.channelId
      );
      await message.reply(
        "✅ Sticky отключён."
      );
      return;
    }

    if (subcommand !== "set") {
      await message.reply(
        "Формат: '!sticky set Текст' или '!sticky clear'."
      );
      return;
    }

    const text = args
      .join(" ")
      .trim()
      .slice(0, 2000);

    if (!text) {
      await message.reply(
        "Укажи текст sticky-сообщения."
      );
      return;
    }

    await this.setSticky(
      message.guild!.id,
      message.channelId,
      text
    );
    await this.repostSticky(
      message.guild!.id,
      message.channelId
    );

    await message.reply(
      "✅ Sticky сохранён."
    );
  }

  private async handleStickySlash(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageMessages
    )) {
      await interaction.reply({
        content:
          "Нужны права Manage Messages.",
        ephemeral: true
      });
      return;
    }

    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === "clear") {
      await this.clearSticky(
        interaction.guildId!,
        interaction.channelId
      );
      await interaction.reply({
        content: "✅ Sticky отключён.",
        ephemeral: true
      });
      return;
    }

    const channel =
      interaction.options.getChannel(
        "channel"
      );

    if (
      channel &&
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement
    ) {
      await interaction.reply({
        content:
          "Sticky channel должен быть текстовым.",
        ephemeral: true
      });
      return;
    }

    const channelId =
      channel?.id ||
      interaction.channelId;

    const text = interaction.options
      .getString("text", true)
      .trim()
      .slice(0, 2000);

    await this.setSticky(
      interaction.guildId!,
      channelId,
      text
    );
    await this.repostSticky(
      interaction.guildId!,
      channelId
    );

    await interaction.reply({
      content: "✅ Sticky сохранён.",
      ephemeral: true
    });
  }

  private async handleMessage(
    message: Message
  ): Promise<void> {
    if (!message.guild || message.author.bot) return;

    if (!await moduleEnabled(
      this.db,
      message.guild.id,
      "community-tools",
      true
    )) {
      return;
    }

    const setting = await this.db.query<{
      channel_id: string;
      message: string;
      last_message_id: string | null;
    }>(
      "SELECT channel_id,message,last_message_id " +
      "FROM sticky_messages " +
      "WHERE guild_id=$1 AND channel_id=$2 AND enabled=true",
      [
        message.guild.id,
        message.channelId
      ]
    );

    if (setting.rows[0]) {
      await this.repostSticky(
        message.guild.id,
        message.channelId,
        setting.rows[0]
      );
    }
  }

  private async setSticky(
    guildId: string,
    channelId: string,
    text: string
  ): Promise<void> {
    await this.db.query(
      "INSERT INTO sticky_messages(guild_id,channel_id,message,enabled) " +
      "VALUES($1,$2,$3,true) " +
      "ON CONFLICT(guild_id,channel_id) " +
      "DO UPDATE SET message=EXCLUDED.message,enabled=true,updated_at=now()",
      [
        guildId,
        channelId,
        text.trim().slice(0, 2000)
      ]
    );
  }

  private async clearSticky(
    guildId: string,
    channelId: string
  ): Promise<void> {
    const rows = await this.db.query<{
      last_message_id: string | null;
    }>(
      "SELECT last_message_id " +
      "FROM sticky_messages " +
      "WHERE guild_id=$1 AND channel_id=$2",
      [guildId, channelId]
    );

    const lastId =
      rows.rows[0]?.last_message_id;

    await this.db.query(
      "UPDATE sticky_messages " +
      "SET enabled=false,last_message_id=NULL,updated_at=now() " +
      "WHERE guild_id=$1 AND channel_id=$2",
      [guildId, channelId]
    );

    if (!lastId || !this.client) return;

    const channel =
      this.client.channels.cache.get(
        channelId
      );

    if (
      !channel?.isTextBased() ||
      !("messages" in channel)
    ) {
      return;
    }

    const old = await channel.messages
      .fetch(lastId)
      .catch(() => null);

    await old?.delete()
      .catch(() => undefined);
  }

  private async repostSticky(
    guildId: string,
    channelId: string,
    setting?: {
      channel_id: string;
      message: string;
      last_message_id: string | null;
    }
  ): Promise<void> {
    const lock =
      guildId +
      ":" +
      channelId;

    if (this.stickyLocks.has(lock)) return;
    this.stickyLocks.add(lock);

    try {
      const current =
        setting ||
        (
          await this.db.query<{
            channel_id: string;
            message: string;
            last_message_id: string | null;
          }>(
            "SELECT channel_id,message,last_message_id " +
            "FROM sticky_messages " +
            "WHERE guild_id=$1 AND channel_id=$2 AND enabled=true",
            [guildId, channelId]
          )
        ).rows[0];

      if (!current || !this.client) return;

      const channel =
        this.client.channels.cache.get(
          channelId
        );

      if (
        !channel ||
        !channel.isTextBased() ||
        !("send" in channel)
      ) {
        return;
      }

      if (
        current.last_message_id &&
        "messages" in channel
      ) {
        const old =
          await channel.messages
            .fetch(current.last_message_id)
            .catch(() => null);

        await old?.delete()
          .catch(() => undefined);
      }

      const posted =
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("📌 Sticky")
              .setDescription(
                current.message
              )
          ]
        })
          .catch(() => null);

      if (!posted) return;

      await this.db.query(
        "UPDATE sticky_messages " +
        "SET last_message_id=$3,updated_at=now() " +
        "WHERE guild_id=$1 AND channel_id=$2 AND enabled=true",
        [
          guildId,
          channelId,
          posted.id
        ]
      );
    } finally {
      this.stickyLocks.delete(lock);
    }
  }

  private async getPoll(
    id: number
  ): Promise<PollRecord | null> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      channel_id: string;
      message_id: string | null;
      question: string;
      options: unknown;
      ends_at: Date | string;
      closed: boolean;
    }>(
      "SELECT id,guild_id,channel_id,message_id,question,options,ends_at,closed " +
      "FROM polls WHERE id=$1",
      [id]
    );

    const row = result.rows[0];
    if (!row) return null;

    let options: string[] = [];

    if (Array.isArray(row.options)) {
      options = row.options.filter(
        (value): value is string =>
          typeof value === "string"
      );
    } else if (typeof row.options === "string") {
      try {
        const parsed =
          JSON.parse(row.options) as unknown;

        if (Array.isArray(parsed)) {
          options = parsed.filter(
            (value): value is string =>
              typeof value === "string"
          );
        }
      } catch {
        options = [];
      }
    }

    return {
      id: Number(row.id),
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      question: row.question,
      options,
      endsAt: new Date(row.ends_at),
      closed: row.closed
    };
  }

  private async getSuggestion(
    id: number
  ): Promise<SuggestionRecord | null> {
    const result = await this.db.query<{
      id: string;
      guild_id: string;
      channel_id: string;
      message_id: string | null;
      user_id: string;
      content: string;
      status: SuggestionStatus;
    }>(
      "SELECT id,guild_id,channel_id,message_id,user_id,content,status " +
      "FROM suggestions WHERE id=$1",
      [id]
    );

    const row = result.rows[0];

    return row
      ? {
          id: Number(row.id),
          guildId: row.guild_id,
          channelId: row.channel_id,
          messageId: row.message_id,
          userId: row.user_id,
          content: row.content,
          status: row.status
        }
      : null;
  }

  private async audit(
    event: import("../audit.js").AuditEvent
  ): Promise<void> {
    try {
      await this.auditLog?.record(event);
    } catch {
      // Audit is telemetry; user operations remain successful.
    }
  }
}

export function parsePipeInput(
  value: string
): string[] {
  return value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function random8BallAnswer(
  random = Math.random
): string {
  const answers = [
    "🎱 Да.",
    "🎱 Скорее да.",
    "🎱 Пока неясно.",
    "🎱 Спроси позже.",
    "🎱 Скорее нет.",
    "🎱 Нет."
  ];

  const index = Math.min(
    answers.length - 1,
    Math.max(
      0,
      Math.floor(
        random() * answers.length
      )
    )
  );

  return answers[index]!;
}

export function chooseFromOptions(
  value: string,
  random = Math.random
): string {
  const options = value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (options.length < 2) {
    return (
      "Дай хотя бы два варианта через '|' или ','."
    );
  }

  const index = Math.min(
    options.length - 1,
    Math.max(
      0,
      Math.floor(
        random() * options.length
      )
    )
  );

  return (
    "🎲 Выпало: **" +
    (options[index] || options[0]!) +
    "**"
  );
}

export function formatDiceRoll(
  notation: string,
  random = Math.random
): string {
  const match = notation
    .trim()
    .toLowerCase()
    .match(/^(\d{1,3})d(\d{1,4})$/);

  if (!match) {
    return "Формат: 2d6, 1d20 и т.п.";
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);

  if (
    count < 1 ||
    count > 100 ||
    sides < 2 ||
    sides > 1000
  ) {
    return (
      "Допустимый диапазон: " +
      "1-100 кубиков и 2-1000 граней."
    );
  }

  const rolls = Array.from(
    { length: count },
    () =>
      1 +
      Math.floor(random() * sides)
  );

  const total = rolls.reduce(
    (sum, value) => sum + value,
    0
  );

  return (
    "🎲 " +
    notation +
    " → **" +
    total +
    "** [" +
    rolls.join(", ") +
    "]"
  );
}
