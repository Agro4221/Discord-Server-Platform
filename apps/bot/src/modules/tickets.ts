import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type TextChannel, type Message } from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type TicketFormFieldType = "short" | "paragraph";
export type TicketFormField = {
  id: string;
  label: string;
  type: TicketFormFieldType;
  required: boolean;
  placeholder: string;
  minLength: number;
  maxLength: number;
};
export type TicketCustomization = {
  panelTitle: string;
  panelDescription: string;
  createButtonLabel: string;
  claimButtonLabel: string;
  closeButtonLabel: string;
};

export const DEFAULT_TICKET_CUSTOMIZATION: Readonly<TicketCustomization> = {
  panelTitle: "🎫 Поддержка",
  panelDescription: "Нажми кнопку ниже — Vexa откроет форму тикета.",
  createButtonLabel: "Создать тикет",
  claimButtonLabel: "Забрать",
  closeButtonLabel: "Закрыть"
};

export type TicketSlaConfig = {
  enabled: boolean;
  firstResponseMinutes: number;
  reminderMinutes: number;
  escalationMinutes: number;
  escalationRoleId: string | null;
};

export type TicketConfig = {
  enabled: boolean;
  categoryId: string | null;
  staffRoleId: string | null;
  transcriptChannelId: string | null;
  maxOpenPerUser: number;
  autoCloseMinutes: number;
  formFields: TicketFormField[];
  customization: TicketCustomization;
  sla: TicketSlaConfig;
};
export const DEFAULT_TICKET_FORM_FIELDS: readonly TicketFormField[] = [
  { id: "subject", label: "Тема", type: "short", required: true, placeholder: "Кратко опиши вопрос", minLength: 3, maxLength: 100 },
  { id: "details", label: "Описание", type: "paragraph", required: true, placeholder: "Что произошло?", minLength: 10, maxLength: 2000 }
];

export class Tickets implements PlatformModule {
  readonly name = "tickets";
  private unsubscribe?: () => void;
  private events?: import("../events.js").PlatformEventBus;
  private client?: ModuleContext["client"];
  private recoveryTimer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.events = context.events;
    this.client = context.client;
    await this.recoverStaleClosures();
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    const m = context.events.on("message.create", (message) => this.onMessage(message));
    this.unsubscribe = () => { a(); b(); m(); };
    this.recoveryTimer = setInterval(() => {
      void Promise.all([
        this.recoverStaleClosures(),
        this.processSla()
      ]).catch((error) => {
        logger.warn("Ticket background maintenance failed", { error: String(error) });
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
    this.client = undefined;
  }

  private async config(guildId: string): Promise<TicketConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      category_id: string | null;
      staff_role_id: string | null;
      transcript_channel_id: string | null;
      max_open_per_user: number;
      auto_close_minutes: number;
      form_fields: unknown;
      panel_title: string | null;
      panel_description: string | null;
      create_button_label: string | null;
      claim_button_label: string | null;
      close_button_label: string | null;
    }>(
      "SELECT enabled,category_id,staff_role_id,transcript_channel_id,max_open_per_user,auto_close_minutes,form_fields,panel_title,panel_description,create_button_label,claim_button_label,close_button_label FROM ticket_settings WHERE guild_id=$1",
      [guildId]
    );
    const slaResult = await this.db.query<{
      enabled: boolean;
      first_response_minutes: number;
      reminder_minutes: number;
      escalation_minutes: number;
      escalation_role_id: string | null;
    }>(
      "SELECT enabled,first_response_minutes,reminder_minutes,escalation_minutes,escalation_role_id FROM ticket_sla_settings WHERE guild_id=$1",
      [guildId]
    );
    const sla = slaResult.rows[0];

    const row = result.rows[0];
    return {
      enabled: row?.enabled ?? false,
      categoryId: row?.category_id ?? null,
      staffRoleId: row?.staff_role_id ?? null,
      transcriptChannelId: row?.transcript_channel_id ?? null,
      maxOpenPerUser: Math.min(Math.max(Number(row?.max_open_per_user ?? 1), 1), 10),
      autoCloseMinutes: Math.min(Math.max(Number(row?.auto_close_minutes ?? 0), 0), 43200),
      formFields: normalizeFormFields(row?.form_fields),
      customization: normalizeTicketCustomization({
        panelTitle: row?.panel_title ?? undefined,
        panelDescription: row?.panel_description ?? undefined,
        createButtonLabel: row?.create_button_label ?? undefined,
        claimButtonLabel: row?.claim_button_label ?? undefined,
        closeButtonLabel: row?.close_button_label ?? undefined
      }),
      sla: {
        enabled: sla?.enabled ?? false,
        firstResponseMinutes: Math.min(Math.max(Number(sla?.first_response_minutes ?? 30), 1), 10080),
        reminderMinutes: Math.min(Math.max(Number(sla?.reminder_minutes ?? 120), 1), 10080),
        escalationMinutes: Math.min(Math.max(Number(sla?.escalation_minutes ?? 240), 1), 20160),
        escalationRoleId: sla?.escalation_role_id ?? null
      }
    };
  }

  async configure(guildId: string, patch: Partial<TicketConfig>): Promise<void> {
    const current = await this.config(guildId);
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO ticket_settings(guild_id,enabled,category_id,staff_role_id,transcript_channel_id,max_open_per_user,auto_close_minutes,form_fields,panel_title,panel_description,create_button_label,claim_button_label,close_button_label)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,category_id=EXCLUDED.category_id,staff_role_id=EXCLUDED.staff_role_id,transcript_channel_id=EXCLUDED.transcript_channel_id,max_open_per_user=EXCLUDED.max_open_per_user,auto_close_minutes=EXCLUDED.auto_close_minutes,form_fields=EXCLUDED.form_fields,panel_title=EXCLUDED.panel_title,panel_description=EXCLUDED.panel_description,create_button_label=EXCLUDED.create_button_label,claim_button_label=EXCLUDED.claim_button_label,close_button_label=EXCLUDED.close_button_label,updated_at=now()`,
      [guildId,next.enabled,next.categoryId,next.staffRoleId,next.transcriptChannelId,Math.min(Math.max(Math.trunc(next.maxOpenPerUser),1),10),Math.min(Math.max(Math.trunc(next.autoCloseMinutes),0),43200),JSON.stringify(normalizeFormFields(next.formFields)),normalizeTicketCustomization(next.customization).panelTitle,normalizeTicketCustomization(next.customization).panelDescription,normalizeTicketCustomization(next.customization).createButtonLabel,normalizeTicketCustomization(next.customization).claimButtonLabel,normalizeTicketCustomization(next.customization).closeButtonLabel]
    );
    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'tickets',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId,next.enabled]
    );
  }

  async getSlaConfig(guildId: string): Promise<TicketSlaConfig> {
    return (await this.config(guildId)).sla;
  }

  async setSlaConfig(guildId: string, input: Partial<TicketSlaConfig>): Promise<TicketSlaConfig> {
    const current = await this.config(guildId);
    const next: TicketSlaConfig = {
      enabled: input.enabled ?? current.sla.enabled,
      firstResponseMinutes: Math.min(Math.max(Math.trunc(input.firstResponseMinutes ?? current.sla.firstResponseMinutes), 1), 10080),
      reminderMinutes: Math.min(Math.max(Math.trunc(input.reminderMinutes ?? current.sla.reminderMinutes), 1), 10080),
      escalationMinutes: Math.min(Math.max(Math.trunc(input.escalationMinutes ?? current.sla.escalationMinutes), 1), 20160),
      escalationRoleId: input.escalationRoleId !== undefined ? input.escalationRoleId : current.sla.escalationRoleId
    };
    await this.db.query(
      "INSERT INTO ticket_sla_settings(guild_id,enabled,first_response_minutes,reminder_minutes,escalation_minutes,escalation_role_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,first_response_minutes=EXCLUDED.first_response_minutes,reminder_minutes=EXCLUDED.reminder_minutes,escalation_minutes=EXCLUDED.escalation_minutes,escalation_role_id=EXCLUDED.escalation_role_id,updated_at=now()",
      [guildId,next.enabled,next.firstResponseMinutes,next.reminderMinutes,next.escalationMinutes,next.escalationRoleId]
    );
    return next;
  }

  async listTickets(guildId: string, status?: "open" | "closed" | "closing"): Promise<Array<{
    id: number;
    channelId: string;
    creatorId: string;
    claimedBy: string | null;
    status: "open" | "closed" | "closing";
    priority: "low" | "normal" | "high" | "urgent";
    tags: string[];
    createdAt: string;
    closedAt: string | null;
    lastActivityAt: string | null;
  }>> {
    const result = await this.db.query<{
      id: string;
      channel_id: string;
      creator_id: string;
      claimed_by: string | null;
      status: "open" | "closed" | "closing";
      priority: "low" | "normal" | "high" | "urgent";
      tags: string[];
      created_at: string;
      closed_at: string | null;
      last_activity_at: string | null;
    }>(
      "SELECT id,channel_id,creator_id,claimed_by,status,priority,tags,created_at,closed_at,last_activity_at FROM tickets WHERE guild_id=$1" +
      (status ? " AND status=$2" : "") +
      " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,created_at DESC LIMIT 200",
      status ? [guildId,status] : [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      channelId: row.channel_id,
      creatorId: row.creator_id,
      claimedBy: row.claimed_by,
      status: row.status,
      priority: row.priority,
      tags: Array.isArray(row.tags) ? row.tags : [],
      createdAt: row.created_at,
      closedAt: row.closed_at,
      lastActivityAt: row.last_activity_at
    }));
  }

  async updateTicketMetadata(
    guildId: string,
    ticketId: number,
    input: { priority?: "low" | "normal" | "high" | "urgent"; tags?: string[] }
  ): Promise<boolean> {
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) throw new Error("invalid_ticket_id");
    if (input.priority !== undefined && !["low","normal","high","urgent"].includes(input.priority)) throw new Error("invalid_ticket_priority");
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags) || input.tags.length > 10) throw new Error("invalid_ticket_tags");
      if (input.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 40)) throw new Error("invalid_ticket_tags");
    }
    const current = await this.db.query<{ priority: "low" | "normal" | "high" | "urgent"; tags: string[] }>(
      "SELECT priority,tags FROM tickets WHERE id=$1 AND guild_id=$2",
      [ticketId,guildId]
    );
    const row = current.rows[0];
    if (!row) return false;
    const result = await this.db.query(
      "UPDATE tickets SET priority=$1,tags=$2,updated_at=now() WHERE id=$3 AND guild_id=$4",
      [input.priority ?? row.priority, input.tags ?? row.tags, ticketId, guildId]
    );
    return result.rowCount === 1;
  }

  async closeByAutomation(guildId: string, ticketId: number, actorUserId: string): Promise<boolean> {
    if (!await moduleEnabled(this.db, guildId, "tickets", false)) throw new Error("tickets_disabled");
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) throw new Error("invalid_ticket_id");

    const result = await this.db.query<{
      channel_id: string;
      status: "open" | "closed" | "closing";
    }>(
      "SELECT channel_id,status FROM tickets WHERE id=$1 AND guild_id=$2",
      [ticketId, guildId]
    );
    const row = result.rows[0];
    if (!row) return false;
    if (row.status !== "open") return false;

    const claimed = await this.db.query<{ channel_id: string }>(
      "UPDATE tickets SET status='closing',closing_at=now() WHERE id=$1 AND guild_id=$2 AND status='open' RETURNING channel_id",
      [ticketId, guildId]
    );
    if (!claimed.rows[0]) return false;

    const guild = this.client?.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(claimed.rows[0].channel_id);
    let transcript = "Transcript unavailable.";

    try {
      transcript = channel?.type === ChannelType.GuildText ? await this.transcript(channel) : transcript;
      await this.db.transaction(async (client) => {
        await client.query(
          "INSERT INTO ticket_transcripts(ticket_id,guild_id,content) VALUES($1,$2,$3) ON CONFLICT(ticket_id) DO UPDATE SET content=EXCLUDED.content",
          [ticketId,guildId,transcript]
        );
        await client.query(
          "UPDATE tickets SET status='closed',closed_at=now(),closing_at=NULL WHERE id=$1 AND status='closing'",
          [ticketId]
        );
      });
    } catch (error) {
      await this.db.query(
        "UPDATE tickets SET status='open',closing_at=NULL WHERE id=$1 AND status='closing'",
        [ticketId]
      ).catch((rollbackError) => logger.error("Automation ticket close rollback failed", {
        guildId,
        ticketId,
        error: String(rollbackError)
      }));
      logger.error("Automation ticket close failed", { guildId, ticketId, error: String(error) });
      throw error;
    }

    const config = await this.config(guildId);
    if (config.transcriptChannelId) {
      const transcriptChannel = guild?.channels.cache.get(config.transcriptChannelId);
      if (transcriptChannel?.isTextBased() && "send" in transcriptChannel) {
        const { AttachmentBuilder } = await import("discord.js");
        await transcriptChannel.send({
          content: "Transcript ticket #" + ticketId,
          files: [new AttachmentBuilder(
            Buffer.from(
              channel?.type === ChannelType.GuildText ? await this.transcriptHtml(channel) : transcript,
              "utf8"
            ),
            { name: "ticket-" + ticketId + ".html" }
          )]
        }).catch((error) => logger.warn("Automation ticket transcript delivery failed", {
          guildId,
          ticketId,
          channelId: config.transcriptChannelId,
          error: String(error)
        }));
      }
    }

    await this.events?.emit("ticket.close", {
      guildId,
      userId: actorUserId,
      ticketId,
      channelId: row.channel_id
    });

    if (channel?.type === ChannelType.GuildText) {
      await channel.delete("Ticket closed by automation").catch((error) => {
        logger.warn("Automation ticket channel cleanup failed", {
          guildId,
          ticketId,
          channelId: row.channel_id,
          error: String(error)
        });
      });
    }

    return true;
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
      .setLabel(config.customization.createButtonLabel)
      .setStyle(ButtonStyle.Primary);
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(config.customization.panelTitle)
          .setDescription(config.customization.panelDescription)
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
        transcriptChannelId: transcriptChannel?.id ?? null,
        maxOpenPerUser: interaction.options.getInteger("max-open") ?? 1,
        autoCloseMinutes: interaction.options.getInteger("auto-close") ?? 0
      });
      await interaction.reply({ content: "Tickets настроены и включены.", ephemeral: true });
      return;
    }

    if (sub === "reopen") {
      if (!await moduleEnabled(this.db, interaction.guild!.id, "tickets", false)) {
        await interaction.reply({ content: "Tickets выключены.", ephemeral: true });
        return;
      }

      const id = interaction.options.getInteger("id", true);
      const result = await this.db.query<{
        channel_id: string;
        creator_id: string;
        status: "open" | "closed" | "closing";
      }>(
        "SELECT channel_id,creator_id,status FROM tickets WHERE id=$1 AND guild_id=$2",
        [id, interaction.guild!.id]
      );
      const row = result.rows[0];
      if (!row) {
        await interaction.reply({ content: "Тикет не найден.", ephemeral: true });
        return;
      }
      const config = await this.config(interaction.guild!.id);
      const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
      if (!canManage && row.creator_id !== interaction.user.id) {
        await interaction.reply({ content: "Переоткрыть тикет может его автор или staff.", ephemeral: true });
        return;
      }
      if (row.status !== "closed") {
        await interaction.reply({ content: "Этот тикет уже открыт или закрывается.", ephemeral: true });
        return;
      }

      const active = await this.db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM tickets WHERE guild_id=$1 AND creator_id=$2 AND status IN ('open','closing')",
        [interaction.guild!.id, row.creator_id]
      );
      if (Number(active.rows[0]?.count ?? 0) >= config.maxOpenPerUser) {
        await interaction.reply({
          content: "Нельзя переоткрыть тикет: достигнут лимит открытых тикетов для этого пользователя.",
          ephemeral: true
        });
        return;
      }

      const guild = interaction.guild!;
      const me = guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.reply({ content: "Боту не хватает Manage Channels.", ephemeral: true });
        return;
      }

      const channel = await guild.channels.create({
        name: "ticket-reopen-" + id,
        type: ChannelType.GuildText,
        parent: config.categoryId ?? undefined,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: row.creator_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...(config.staffRoleId ? [{ id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
        ]
      });

      try {
        await this.db.query(
          "UPDATE tickets SET status='open',channel_id=$1,closed_at=NULL,closing_at=NULL,last_activity_at=now() WHERE id=$2 AND guild_id=$3 AND status='closed'",
          [channel.id,id,guild.id]
        );
        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("dsp:ticket:claim:" + id).setLabel(config.customization.claimButtonLabel).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("dsp:ticket:close:" + id).setLabel(config.customization.closeButtonLabel).setStyle(ButtonStyle.Danger)
        );
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎫 Тикет #" + id + " переоткрыт")
              .setDescription("Тикет снова доступен. Предыдущая история сохранена в transcript.")
          ],
          components: [buttons]
        });
        await interaction.reply({ content: "Тикет #" + id + " переоткрыт: <#" + channel.id + ">.", ephemeral: true });
      } catch (error) {
        await channel.delete("Ticket reopen rollback").catch(() => undefined);
        logger.warn("Ticket reopen failed", {
          guildId: guild.id,
          ticketId: id,
          error: String(error)
        });
        await interaction.reply({ content: "Не удалось переоткрыть тикет.", ephemeral: true });
      }
      return;
    }

    if (sub !== "create") return;
    if (!await moduleEnabled(this.db, interaction.guild!.id, "tickets", false)) {
      await interaction.reply({ content: "Tickets выключены. Сначала выполни `/ticket setup`.", ephemeral: true });
      return;
    }

    const config = await this.config(interaction.guild!.id);
    const existing = await this.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM tickets WHERE guild_id=$1 AND creator_id=$2 AND status IN ('open','closing')",
      [interaction.guild!.id,interaction.user.id]
    );
    if (Number(existing.rows[0]?.count ?? 0) >= config.maxOpenPerUser) {
      await interaction.reply({
        content: `Достигнут лимит открытых тикетов: **${config.maxOpenPerUser}**.`,
        ephemeral: true
      });
      return;
    }

    await this.showCreateModal(interaction);
  }

  async getFormFields(guildId: string): Promise<TicketFormField[]> {
    return (await this.config(guildId)).formFields;
  }

  async getCustomization(guildId: string): Promise<TicketCustomization> {
    return (await this.config(guildId)).customization;
  }

  async setCustomization(guildId: string, customization: Partial<TicketCustomization>): Promise<TicketCustomization> {
    const current = await this.config(guildId);
    const next = normalizeTicketCustomization({ ...current.customization, ...customization });
    await this.db.query(
      `INSERT INTO ticket_settings(
         guild_id,enabled,category_id,staff_role_id,transcript_channel_id,max_open_per_user,auto_close_minutes,form_fields,panel_title,panel_description,create_button_label,claim_button_label,close_button_label
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(guild_id) DO UPDATE SET panel_title=EXCLUDED.panel_title,panel_description=EXCLUDED.panel_description,create_button_label=EXCLUDED.create_button_label,claim_button_label=EXCLUDED.claim_button_label,close_button_label=EXCLUDED.close_button_label,updated_at=now()`,
      [guildId,current.enabled,current.categoryId,current.staffRoleId,current.transcriptChannelId,current.maxOpenPerUser,current.autoCloseMinutes,JSON.stringify(current.formFields),next.panelTitle,next.panelDescription,next.createButtonLabel,next.claimButtonLabel,next.closeButtonLabel]
    );
    return next;
  }

  async setFormFields(guildId: string, fields: TicketFormField[]): Promise<TicketFormField[]> {
    const normalized = normalizeFormFields(fields);
    const current = await this.config(guildId);
    await this.db.query(
      `INSERT INTO ticket_settings(
         guild_id,enabled,category_id,staff_role_id,transcript_channel_id,max_open_per_user,auto_close_minutes,form_fields
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(guild_id) DO UPDATE SET form_fields=EXCLUDED.form_fields,updated_at=now()`,
      [guildId,current.enabled,current.categoryId,current.staffRoleId,current.transcriptChannelId,current.maxOpenPerUser,current.autoCloseMinutes,JSON.stringify(normalized),current.customization.panelTitle,current.customization.panelDescription,current.customization.createButtonLabel,current.customization.claimButtonLabel,current.customization.closeButtonLabel]
    );
    return normalized;
  }

  private async showCreateModal(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
    const fields = (await this.config(interaction.guild!.id)).formFields;
    const modal = new ModalBuilder().setCustomId("dsp:ticket:create").setTitle("Создать тикет");
    for (const field of fields) {
      const input = new TextInputBuilder()
        .setCustomId("ticket:" + field.id)
        .setLabel(field.label.slice(0, 45))
        .setStyle(field.type === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(field.required)
        .setMinLength(field.minLength)
        .setMaxLength(field.maxLength);
      if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }
    await interaction.showModal(modal);
  }

  private async createTicket(interaction: ModalSubmitInteraction): Promise<void> {
    const config = await this.config(interaction.guild!.id);
    const me = interaction.guild!.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: "Боту не хватает Manage Channels.", ephemeral: true });
      return;
    }

    const fields = config.formFields.length ? config.formFields : [...DEFAULT_TICKET_FORM_FIELDS];
    const formData: Record<string, string> = {};
    for (const field of fields) {
      formData[field.id] = interaction.fields.getTextInputValue("ticket:" + field.id);
    }
    const validationError = validateTicketFormSubmission(fields, formData);
    if (validationError) {
      await interaction.reply({ content: validationError, ephemeral: true });
      return;
    }
    const subject = formData.subject?.trim() || formData[fields[0]?.id ?? ""]?.trim() || "Тикет";
    const details = formData.details?.trim() || Object.entries(formData)
      .map(([id, value]) => "**" + (fields.find((field) => field.id === id)?.label ?? id) + ":**\n" + value)
      .join("\n\n").slice(0, 3900) || "Без описания";

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
        `INSERT INTO tickets(guild_id,channel_id,creator_id,status,form_data)
         VALUES($1,$2,$3,'open',$4) RETURNING id`,
        [interaction.guild!.id,channel.id,interaction.user.id,JSON.stringify(formData)]
      );
      ticketId = inserted.rows[0]?.id;
      if (!ticketId) throw new Error("ticket_id_missing");

      await channel.send({
        embeds: [
          new EmbedBuilder().setTitle(`🎫 Тикет #${ticketId}`).setDescription(`**Тема:** ${subject}\n\n${details}`)
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`dsp:ticket:claim:${ticketId}`).setLabel(config.customization.claimButtonLabel).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`dsp:ticket:close:${ticketId}`).setLabel(config.customization.closeButtonLabel).setStyle(ButtonStyle.Danger)
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
      await this.showCreateModal(interaction);
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
            files: [new AttachmentBuilder(Buffer.from(
              channel?.type === ChannelType.GuildText ? await this.transcriptHtml(channel) : transcript,
              "utf8"
            ), { name: `ticket-${ticketId}.html` })]
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

  private async onMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId) return;
    await this.db.query(
      "UPDATE tickets SET last_activity_at=now() WHERE guild_id=$1 AND channel_id=$2 AND status='open'",
      [message.guild.id,message.channelId]
    ).catch((error) => {
      logger.warn("Ticket activity update failed", {
        guildId: message.guild!.id,
        channelId: message.channelId,
        error: String(error)
      });
    });
  }

  private async processSla(): Promise<void> {
    const settings = await this.db.query<{
      guild_id: string;
      enabled: boolean;
      first_response_minutes: number;
      reminder_minutes: number;
      escalation_minutes: number;
      escalation_role_id: string | null;
    }>(
      "SELECT guild_id,enabled,first_response_minutes,reminder_minutes,escalation_minutes,escalation_role_id FROM ticket_sla_settings WHERE enabled=true",
      []
    );

    for (const config of settings.rows) {
      const tickets = await this.db.query<{
        id: string;
        channel_id: string;
        creator_id: string;
        claimed_by: string | null;
        created_at: string;
        last_activity_at: string | null;
        sla_reminded_at: string | null;
        sla_escalated_at: string | null;
      }>(
        "SELECT id,channel_id,creator_id,claimed_by,created_at,last_activity_at,sla_reminded_at,sla_escalated_at FROM tickets WHERE guild_id=$1 AND status='open' AND (sla_reminded_at IS NULL OR sla_escalated_at IS NULL) ORDER BY created_at ASC LIMIT 100",
        [config.guild_id]
      );

      const guild = this.client?.guilds.cache.get(config.guild_id);
      for (const ticket of tickets.rows) {
        const channel = guild?.channels.cache.get(ticket.channel_id);
        if (!channel || !channel.isTextBased() || !("send" in channel)) continue;

        const createdAt = Date.parse(ticket.created_at);
        const lastActivityAt = ticket.last_activity_at ? Date.parse(ticket.last_activity_at) : createdAt;
        const ageMinutes = Math.max(0, (Date.now() - createdAt) / 60000);
        const inactivityMinutes = Math.max(0, (Date.now() - lastActivityAt) / 60000);

        if (!ticket.sla_reminded_at &&
            (!ticket.claimed_by ? ageMinutes >= Number(config.first_response_minutes) : inactivityMinutes >= Number(config.reminder_minutes))) {
          const target = ticket.claimed_by ? "<@" + ticket.claimed_by + ">" : (config.escalation_role_id ? "<@&" + config.escalation_role_id + ">" : "staff");
          await channel.send("⏰ **SLA reminder** · тикет #" + ticket.id + " требует внимания. " + target).catch(() => undefined);
          await this.db.query("UPDATE tickets SET sla_reminded_at=now(),updated_at=now() WHERE id=$1 AND guild_id=$2 AND sla_reminded_at IS NULL", [ticket.id,config.guild_id]);
        }

        if (!ticket.sla_escalated_at && ageMinutes >= Number(config.escalation_minutes)) {
          const target = config.escalation_role_id ? "<@&" + config.escalation_role_id + ">" : "staff";
          await channel.send("🚨 **SLA escalation** · тикет #" + ticket.id + " превысил SLA. " + target).catch(() => undefined);
          await this.db.query("UPDATE tickets SET sla_escalated_at=now(),updated_at=now() WHERE id=$1 AND guild_id=$2 AND sla_escalated_at IS NULL", [ticket.id,config.guild_id]);
        }
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
    await this.autoCloseStaleTickets();
  }

  private async autoCloseStaleTickets(): Promise<void> {
    if (!this.client) return;
    const stale = await this.db.query<{
      id: string;
      guild_id: string;
      channel_id: string;
      transcript_channel_id: string | null;
    }>(
      `SELECT t.id,t.guild_id,t.channel_id,ts.transcript_channel_id
       FROM tickets t
       INNER JOIN ticket_settings ts ON ts.guild_id=t.guild_id
       WHERE t.status='open'
         AND ts.auto_close_minutes > 0
         AND t.last_activity_at < now() - make_interval(mins => ts.auto_close_minutes)
       ORDER BY t.last_activity_at ASC
       LIMIT 25`
    );

    for (const row of stale.rows) {
      const claimed = await this.db.query<{ channel_id: string }>(
        "UPDATE tickets SET status='closing',closing_at=now() WHERE id=$1 AND status='open' RETURNING channel_id",
        [row.id]
      );
      if (!claimed.rows[0]) continue;

      const guild = this.client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.channel_id);
      try {
        const transcript = channel?.type === ChannelType.GuildText
          ? await this.transcript(channel)
          : "Transcript unavailable.";

        await this.db.transaction(async (client) => {
          await client.query(
            "INSERT INTO ticket_transcripts(ticket_id,guild_id,content) VALUES($1,$2,$3) ON CONFLICT(ticket_id) DO UPDATE SET content=EXCLUDED.content",
            [row.id,row.guild_id,transcript]
          );
          await client.query(
            "UPDATE tickets SET status='closed',closed_at=now(),closing_at=NULL WHERE id=$1 AND status='closing'",
            [row.id]
          );
        });

        if (row.transcript_channel_id) {
          const target = guild?.channels.cache.get(row.transcript_channel_id);
          if (target?.isTextBased() && "send" in target) {
            const { AttachmentBuilder } = await import("discord.js");
            await target.send({
              content: `Transcript ticket #${row.id} (auto-closed)`,
              files: [new AttachmentBuilder(Buffer.from(
                channel?.type === ChannelType.GuildText ? await this.transcriptHtml(channel) : transcript,
                "utf8"
              ), { name: `ticket-${row.id}.html` })]
            }).catch(() => undefined);
          }
        }

        if (channel?.type === ChannelType.GuildText) {
          await channel.delete("Ticket auto-closed after inactivity").catch(() => undefined);
        }
      } catch (error) {
        await this.db.query(
          "UPDATE tickets SET status='open',closing_at=NULL WHERE id=$1 AND status='closing'",
          [row.id]
        ).catch(() => undefined);
        logger.warn("Ticket auto-close failed", {
          guildId: row.guild_id,
          ticketId: row.id,
          error: String(error)
        });
      }
    }
  }

  private canStaff(interaction: ButtonInteraction, config: TicketConfig): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    if (!config.staffRoleId || !interaction.member || !("roles" in interaction.member)) return false;
    const roles = interaction.member.roles;
    return Array.isArray(roles) ? roles.includes(config.staffRoleId) : roles.cache.has(config.staffRoleId);
  }

  private async fetchTranscriptMessages(channel: TextChannel): Promise<import("discord.js").Collection<string, Message> | null> {
    return channel.messages.fetch({ limit: 100 }).catch((error) => {
      logger.warn("Ticket transcript fetch failed", {
        guildId: channel.guild.id,
        channelId: channel.id,
        error: String(error)
      });
      return null;
    });
  }

  private async transcript(channel: TextChannel): Promise<string> {
    const messages = await this.fetchTranscriptMessages(channel);
    if (!messages) return "Transcript unavailable.";
    return [...messages.values()]
      .sort((a,b) => a.createdTimestamp-b.createdTimestamp)
      .map((message) => "[" + new Date(message.createdTimestamp).toISOString() + "] " + message.author.tag + ": " + message.content)
      .join("\n");
  }

  private async transcriptHtml(channel: TextChannel): Promise<string> {
    const messages = await this.fetchTranscriptMessages(channel);
    if (!messages) return "<!doctype html><html><body><p>Transcript unavailable.</p></body></html>";
    const escape = (value: string) => value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    const rows = [...messages.values()]
      .sort((a,b) => a.createdTimestamp-b.createdTimestamp)
      .map((message) =>
        "<article><header><strong>" + escape(message.author.tag) + "</strong> · " +
        escape(new Date(message.createdTimestamp).toISOString()) +
        "</header><pre>" + escape(message.content) + "</pre></article>"
      )
      .join("\n");
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Ticket transcript</title><style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e7e9ee;padding:24px}article{padding:12px 0;border-bottom:1px solid #2a2f39}header{color:#9aa4b2;font-size:13px}pre{white-space:pre-wrap;word-break:break-word;font:inherit}</style></head><body>" + rows + "</body></html>";
  }
}


export function isOpenTicketConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; constraint?: unknown };
  return value.code === "23505" && value.constraint === "uq_open_ticket_per_creator";
}

function normalizeFormFields(value: unknown): TicketFormField[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized: TicketFormField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim().toLowerCase() : "";
    const label = typeof source.label === "string" ? source.label.trim().slice(0, 45) : "";
    const type: TicketFormFieldType = source.type === "paragraph" ? "paragraph" : "short";
    const placeholder = typeof source.placeholder === "string" ? source.placeholder.trim().slice(0, 100) : "";
    const rawMax = typeof source.maxLength === "number" ? Math.trunc(source.maxLength) : type === "paragraph" ? 2000 : 100;
    const maxLength = Math.min(Math.max(rawMax, 1), type === "paragraph" ? 4000 : 400);
    const rawMin = typeof source.minLength === "number" ? Math.trunc(source.minLength) : 0;
    const minLength = Math.min(Math.max(rawMin, 0), maxLength);
    if (!/^[a-z0-9_-]{1,30}$/.test(id) || !label || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id,label,type,required:source.required !== false,placeholder,minLength,maxLength });
    if (normalized.length >= 5) break;
  }
  return normalized.length ? normalized : [...DEFAULT_TICKET_FORM_FIELDS];
}

 
export function validateTicketFormSubmission(
  fields: TicketFormField[],
  values: Record<string, string>
): string | null {
  for (const field of fields) {
    const value = typeof values[field.id] === "string" ? values[field.id].trim() : "";
    if (field.required && !value) return "Заполни обязательное поле: " + field.label + ".";
    if (value.length < field.minLength) return "Поле «" + field.label + "» слишком короткое: минимум " + field.minLength + " символа.";
    if (value.length > field.maxLength) return "Поле «" + field.label + "» слишком длинное: максимум " + field.maxLength + " символов.";
  }
  return null;
}

export function normalizeTicketCustomization(input?: Partial<TicketCustomization> | null): TicketCustomization {
  const source = input ?? {};
  const clean = (value: unknown, fallback: string, max: number) => {
    const text = typeof value === "string" ? value.trim().slice(0, max) : "";
    return text || fallback;
  };
  return {
    panelTitle: clean(source.panelTitle, DEFAULT_TICKET_CUSTOMIZATION.panelTitle, 256),
    panelDescription: clean(source.panelDescription, DEFAULT_TICKET_CUSTOMIZATION.panelDescription, 1000),
    createButtonLabel: clean(source.createButtonLabel, DEFAULT_TICKET_CUSTOMIZATION.createButtonLabel, 80),
    claimButtonLabel: clean(source.claimButtonLabel, DEFAULT_TICKET_CUSTOMIZATION.claimButtonLabel, 80),
    closeButtonLabel: clean(source.closeButtonLabel, DEFAULT_TICKET_CUSTOMIZATION.closeButtonLabel, 80)
  };
}
