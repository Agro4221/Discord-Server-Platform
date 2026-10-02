import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type TextChannel, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

type TicketConfig = {
  enabled: boolean;
  categoryId: string | null;
  staffRoleId: string | null;
  transcriptChannelId: string | null;
};

export class Tickets implements PlatformModule {
  readonly name = "tickets";
  private unsubscribe?: () => void;
  private events?: import("../events.js").PlatformEventBus;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.events = context.events;
    await this.recoverStaleClosures();
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); };
    this.recoveryTimer = setInterval(() => {
      void this.recoverStaleClosures().catch((error) => {
        logger.warn("Ticket stale-closure recovery failed", { error: String(error) });
      });
    }, 60_000);
    this.recoveryTimer.unref();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.events = undefined;
  }

  private async config(guildId: string): Promise<TicketConfig> {
    const result = await this.db.query<{ enabled: boolean; category_id: string | null; staff_role_id: string | null; transcript_channel_id: string | null }>(
      "SELECT enabled,category_id,staff_role_id,transcript_channel_id FROM ticket_settings WHERE guild_id=$1",
      [guildId]
    );
    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      categoryId: row?.category_id ?? null,
      staffRoleId: row?.staff_role_id ?? null,
      transcriptChannelId: row?.transcript_channel_id ?? null
    };
  }

  async configure(guildId: string, patch: Partial<TicketConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO ticket_settings(guild_id,enabled,category_id,staff_role_id,transcript_channel_id)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,category_id=EXCLUDED.category_id,staff_role_id=EXCLUDED.staff_role_id,transcript_channel_id=EXCLUDED.transcript_channel_id,updated_at=now()`,
      [guildId,next.enabled,next.categoryId,next.staffRoleId,next.transcriptChannelId]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'tickets',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId,next.enabled]
    );
  }

  async handlePrefixCommand(message: Message, commandName: string): Promise<boolean> {
    if (!message.guild || message.author.bot || commandName !== "ticket") return false;
    if (!await moduleEnabled(this.db, message.guild.id, "tickets", false)) {
      await message.reply("Модуль Tickets выключен.");
      return true;
    }

    const config = await this.config(message.guild.id);
    if (!config.categoryId || !config.staffRoleId) {
      await message.reply("Tickets ещё не настроены. Администратор может открыть раздел Tickets в dashboard.");
      return true;
    }

    const button = new ButtonBuilder()
      .setCustomId("dsp:ticket:quick")
      .setLabel("Создать тикет")
      .setStyle(ButtonStyle.Primary);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎫 Поддержка")
          .setDescription("Нажми кнопку ниже — Vexa откроет форму тикета.")
      ],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)]
    });
    return true;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "ticket") return;
    const sub = interaction.options.getSubcommand();

    if (sub === "setup") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
        return;
      }
      const categoryOption = interaction.options.getChannel("category");
      const staffRole = interaction.options.getRole("staff-role");
      const transcriptOption = interaction.options.getChannel("transcript-channel");
      const category = categoryOption ? interaction.guild!.channels.cache.get(categoryOption.id) : null;
      const transcriptChannel = transcriptOption ? interaction.guild!.channels.cache.get(transcriptOption.id) : null;
      if (categoryOption && (!category || category.type !== ChannelType.GuildCategory)) {
        await interaction.reply({ content: "Category должна быть категорией.", ephemeral: true });
        return;
      }
      if (transcriptOption && (!transcriptChannel || !transcriptChannel.isTextBased())) {
        await interaction.reply({ content: "Transcript channel должен быть текстовым.", ephemeral: true });
        return;
      }
      await this.configure(interaction.guild!.id, {
        enabled: true,
        categoryId: category?.id ?? null,
        staffRoleId: staffRole?.id ?? null,
        transcriptChannelId: transcriptChannel?.id ?? null
      });
      await interaction.reply({ content: "Tickets настроены и включены.", ephemeral: true });
      return;
    }

    if (sub !== "create") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "tickets", false)) {
      await interaction.reply({ content: "Tickets выключены. Сначала выполни `/ticket setup`.", ephemeral: true });
      return;
    }

    const existing = await this.db.query<{ channel_id: string }>(
      "SELECT channel_id FROM tickets WHERE guild_id=$1 AND creator_id=$2 AND status='open' LIMIT 1",
      [interaction.guild!.id,interaction.user.id]
    );
    if (existing.rows[0]?.channel_id) {
      await interaction.reply({ content: `У тебя уже есть открытый тикет: <#${existing.rows[0].channel_id}>.`, ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId("dsp:ticket:create")
      .setTitle("Создать тикет")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("subject").setLabel("Тема").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("details").setLabel("Описание").setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true)
        )
      );
    await interaction.showModal(modal);
  }

  private async createTicket(interaction: ModalSubmitInteraction): Promise<void> {
    const config = await this.config(interaction.guild!.id);
    const me = interaction.guild!.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Боту не хватает Manage Channels.", ephemeral: true });
      return;
    }

    const subject = interaction.fields.getTextInputValue("subject");
    const details = interaction.fields.getTextInputValue("details");

    const channel = await interaction.guild!.channels.create({
      name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
      type: ChannelType.GuildText,
      parent: config.categoryId ?? undefined,
      permissionOverwrites: [
        { id: interaction.guild!.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ...(config.staffRoleId ? [{ id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
      ]
    });

    let ticketId: string | undefined;
    try {
      const inserted = await this.db.query<{ id: string }>(
        `INSERT INTO tickets(guild_id,channel_id,creator_id,status)
         VALUES($1,$2,$3,'open') RETURNING id`,
        [interaction.guild!.id,channel.id,interaction.user.id]
      );
      ticketId = inserted.rows[0]?.id;
      if (!ticketId) throw new Error("ticket_id_missing");

      await channel.send({
        embeds: [
          new EmbedBuilder().setTitle(`🎫 Тикет #${ticketId}`).setDescription(`**Тема:** ${subject}\n\n${details}`)
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`dsp:ticket:claim:${ticketId}`).setLabel("Забрать").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`dsp:ticket:close:${ticketId}`).setLabel("Закрыть").setStyle(ButtonStyle.Danger)
          )
        ]
      });

      await this.events?.emit("ticket.create", {
        guildId: interaction.guild!.id,
        userId: interaction.user.id,
        ticketId: Number(ticketId),
        channelId: channel.id
      });
    } catch (error) {
      await channel.delete("Ticket creation rollback").catch((deleteError) => {
        logger.error("Ticket creation rollback channel delete failed", {
          guildId: interaction.guild!.id,
          channelId: channel.id,
          error: String(deleteError)
        });
      });

      if (ticketId) {
        await this.db.query(
          "DELETE FROM tickets WHERE id=$1 AND guild_id=$2",
          [ticketId, interaction.guild!.id]
        ).catch((deleteError) => {
          logger.error("Ticket creation rollback database delete failed", {
            guildId: interaction.guild!.id,
            ticketId,
            channelId: channel.id,
            error: String(deleteError)
          });
        });
      }

      logger.error("Ticket creation failed and was rolled back", {
        guildId: interaction.guild!.id,
        userId: interaction.user.id,
        channelId: channel.id,
        error: String(error)
      });
      await interaction.reply({
        content: isOpenTicketConflict(error)
          ? "У тебя уже есть открытый тикет. Обнови список каналов и используй существующий."
          : "Не удалось создать тикет.",
        ephemeral: true
      });
      return;
    }

    try {
      await interaction.reply({ content: `Тикет создан: <#${channel.id}>.`, ephemeral: true });
    } catch (error) {
      logger.warn("Ticket creation success response failed", {
        guildId: interaction.guild!.id,
        ticketId: ticketId ?? "unknown",
        channelId: channel.id,
        error: String(error)
      });
    }
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (interaction.isModalSubmit() && interaction.customId === "dsp:ticket:create" && interaction.guild) {
      if (!await moduleEnabled(this.db, interaction.guild!.id, "tickets", false)) {
        await interaction.reply({ content: "Tickets выключены.", ephemeral: true });
        return;
      }
      await this.createTicket(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === "dsp:ticket:quick" && interaction.guild) {
      if (!await moduleEnabled(this.db, interaction.guild.id, "tickets", false)) {
        await interaction.reply({ content: "Tickets выключены.", ephemeral: true });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId("dsp:ticket:create")
        .setTitle("Создать тикет")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("subject").setLabel("Тема").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("details").setLabel("Описание").setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true)
          )
        );
      await interaction.showModal(modal);
      return;
    }

    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:ticket:") || !interaction.guild) return;
    const [, , action, rawId] = interaction.customId.split(":");
    const ticketId = Number(rawId);
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
      await interaction.reply({ content: "Некорректный ticket id.", ephemeral: true });
      return;
    }

    const result = await this.db.query<{ channel_id: string; creator_id: string; status: "open" | "closed"; claimed_by: string | null }>(
      "SELECT channel_id,creator_id,status,claimed_by FROM tickets WHERE id=$1 AND guild_id=$2",
      [ticketId,interaction.guild!.id]
    );
    const row = result.rows[0];
    if (!row) { await interaction.reply({ content: "Тикет не найден.", ephemeral: true }); return; }

    if (action === "claim") {
      const config = await this.config(interaction.guild!.id);
      if (!this.canStaff(interaction, config)) { await interaction.reply({ content: "Кнопка доступна только staff.", ephemeral: true }); return; }
      if (row.status !== "open") { await interaction.reply({ content: "Тикет уже закрыт.", ephemeral: true }); return; }
      const claimed = await this.db.query<{ claimed_by: string }>(
        "UPDATE tickets SET claimed_by=$1 WHERE id=$2 AND status='open' AND (claimed_by IS NULL OR claimed_by=$1) RETURNING claimed_by",
        [interaction.user.id, ticketId]
      );
      if (!claimed.rows[0]) {
        await interaction.reply({ content: "Тикет уже закреплён за другим staff или закрывается.", ephemeral: true });
        return;
      }
      await interaction.reply({ content: "Тикет закреплён за тобой.", ephemeral: true });
      return;
    }

    if (action === "close") {
      const config = await this.config(interaction.guild!.id);
      if (interaction.user.id !== row.creator_id && !this.canStaff(interaction, config)) { await interaction.reply({ content: "Недостаточно прав.", ephemeral: true }); return; }
      const claimedClose = await this.db.query<{ channel_id: string }>(
        "UPDATE tickets SET status='closing',closing_at=now() WHERE id=$1 AND guild_id=$2 AND status='open' RETURNING channel_id",
        [ticketId, interaction.guild!.id]
      );
      if (!claimedClose.rows[0]) {
        await interaction.reply({ content: "Тикет уже закрывается или закрыт.", ephemeral: true });
        return;
      }

      const channel = interaction.guild!.channels.cache.get(claimedClose.rows[0].channel_id);
      let transcript = "Transcript unavailable.";
      await interaction.deferReply({ ephemeral: true });
      try {
        transcript = channel?.type === ChannelType.GuildText ? await this.transcript(channel) : transcript;
        await this.db.transaction(async (client) => {
          await client.query(
            "INSERT INTO ticket_transcripts(ticket_id,guild_id,content) VALUES($1,$2,$3) ON CONFLICT(ticket_id) DO UPDATE SET content=EXCLUDED.content",
            [ticketId,interaction.guild!.id,transcript]
          );
          await client.query(
            "UPDATE tickets SET status='closed',closed_at=now(),closing_at=NULL WHERE id=$1 AND status='closing'",
            [ticketId]
          );
        });
      } catch (error) {
        await this.db.query("UPDATE tickets SET status='open',closing_at=NULL WHERE id=$1 AND status='closing'", [ticketId])
          .catch((rollbackError) => logger.error("Ticket close rollback failed", {
            guildId: interaction.guild!.id,
            ticketId,
            error: String(rollbackError)
          }));
        logger.error("Ticket close transaction failed", {
          guildId: interaction.guild!.id,
          ticketId,
          error: String(error)
        });
        await interaction.editReply({
          content: "Не удалось закрыть тикет. Изменения откатированы."
        }).catch((replyError) => {
          logger.warn("Ticket close failure response failed", {
            guildId: interaction.guild!.id,
            ticketId,
            error: String(replyError)
          });
        });
        return;
      }

      if (config.transcriptChannelId) {
        const transcriptChannel = interaction.guild!.channels.cache.get(config.transcriptChannelId);
        if (transcriptChannel?.isTextBased() && "send" in transcriptChannel) {
          const { AttachmentBuilder } = await import("discord.js");
          await transcriptChannel.send({
            content: `Transcript ticket #${ticketId}`,
            files: [new AttachmentBuilder(Buffer.from(transcript,"utf8"), { name: `ticket-${ticketId}.txt` })]
          }).catch((error) => {
            logger.warn("Ticket transcript delivery failed", {
              guildId: interaction.guild!.id,
              ticketId,
              channelId: config.transcriptChannelId,
              error: String(error)
            });
          });
        }
      }

      await this.events?.emit("ticket.close", {
        guildId: interaction.guild!.id,
        userId: interaction.user.id,
        ticketId,
        channelId: row.channel_id
      });
      await interaction.editReply({ content: "Тикет закрыт и transcript сохранён." });
      if (channel?.type === ChannelType.GuildText) {
        await channel.delete("Ticket closed").catch((error) => {
          logger.warn("Ticket channel cleanup failed", {
            guildId: interaction.guild!.id,
            ticketId,
            channelId: row.channel_id,
            error: String(error)
          });
        });
      }
    }
  }

  private async recoverStaleClosures(): Promise<void> {
    const result = await this.db.query(
      "UPDATE tickets SET status='open',closing_at=NULL WHERE status='closing' AND closing_at IS NOT NULL AND closing_at < now()-interval '10 minutes'"
    );
    if (result.rowCount) {
      logger.warn("Recovered stale Ticket closures", { recovered: result.rowCount });
    }
  }

  private canStaff(interaction: ButtonInteraction, config: TicketConfig): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    if (!config.staffRoleId || !interaction.member || !("roles" in interaction.member)) return false;
    const roles = interaction.member.roles;
    return Array.isArray(roles) ? roles.includes(config.staffRoleId) : roles.cache.has(config.staffRoleId);
  }

  private async transcript(channel: TextChannel): Promise<string> {
    const messages = await channel.messages.fetch({ limit: 100 }).catch((error) => {
      logger.warn("Ticket transcript fetch failed", {
        guildId: channel.guild.id,
        channelId: channel.id,
        error: String(error)
      });
      return null;
    });
    if (!messages) return "Transcript unavailable.";
    return [...messages.values()].sort((a,b) => a.createdTimestamp-b.createdTimestamp).map((message) => `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag}: ${message.content}`).join("\n");
  }
}


export function isOpenTicketConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; constraint?: unknown };
  return value.code === "23505" && value.constraint === "uq_open_ticket_per_creator";
}
