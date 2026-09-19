import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type TextChannel
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type TicketConfig = {
  enabled: boolean;
  categoryId: string | null;
  staffRoleId: string | null;
  transcriptChannelId: string | null;
};

export class Tickets implements PlatformModule {
  readonly name = "tickets";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.unsubscribe = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const componentUnsubscribe = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    const previous = this.unsubscribe;
    this.unsubscribe = () => {
      previous?.();
      componentUnsubscribe();
    };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async config(guildId: string): Promise<TicketConfig> {
    const result = await this.db.query<{
      enabled: boolean;
      category_id: string | null;
      staff_role_id: string | null;
      transcript_channel_id: string | null;
    }>(
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
       ON CONFLICT(guild_id) DO UPDATE SET
       enabled=EXCLUDED.enabled,category_id=EXCLUDED.category_id,
       staff_role_id=EXCLUDED.staff_role_id,transcript_channel_id=EXCLUDED.transcript_channel_id,
       updated_at=now()`,
      [guildId, next.enabled, next.categoryId, next.staffRoleId, next.transcriptChannelId]
    );

    await this.db.query(
      `INSERT INTO guild_modules(guild_id,module_key,enabled)
       VALUES($1,'tickets',$2)
       ON CONFLICT(guild_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [guildId, next.enabled]
    );
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "ticket") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "tickets", false)) {
      await interaction.reply({ content: "Модуль Tickets выключен.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "setup") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
        return;
      }

      const category = interaction.options.getChannel("category");
      const staffRole = interaction.options.getRole("staff-role");
      const transcriptChannel = interaction.options.getChannel("transcript-channel");

      if (category && category.type !== ChannelType.GuildCategory) {
        await interaction.reply({ content: "Category должна быть категорией.", ephemeral: true });
        return;
      }
      if (transcriptChannel && !transcriptChannel.isTextBased()) {
        await interaction.reply({ content: "Transcript channel должен быть текстовым.", ephemeral: true });
        return;
      }

      await this.configure(interaction.guild.id, {
        enabled: true,
        categoryId: category?.id ?? null,
        staffRoleId: staffRole?.id ?? null,
        transcriptChannelId: transcriptChannel?.id ?? null
      });
      await interaction.reply({ content: "Tickets настроены и включены.", ephemeral: true });
      return;
    }

    if (sub === "create") {
      const config = await this.config(interaction.guild.id);
      const existing = await this.db.query<{ channel_id: string }>(
        "SELECT channel_id FROM tickets WHERE guild_id=$1 AND creator_id=$2 AND status='open' LIMIT 1",
        [interaction.guild.id, interaction.user.id]
      );
      const existingChannelId = existing.rows[0]?.channel_id;
      if (existingChannelId) {
        await interaction.reply({ content: `У тебя уже есть открытый тикет: <#${existingChannelId}>.`, ephemeral: true });
        return;
      }

      const me = interaction.guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.reply({ content: "Боту не хватает Manage Channels.", ephemeral: true });
        return;
      }

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
        type: ChannelType.GuildText,
        parent: config.categoryId ?? undefined,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          },
          ...(config.staffRoleId
            ? [{
                id: config.staffRoleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
              }]
            : [{
                id: interaction.guild.roles.everyone.id,
                deny: [PermissionFlagsBits.SendMessages]
              }])
        ]
      });

      const inserted = await this.db.query<{ id: string }>(
        `INSERT INTO tickets(guild_id,channel_id,creator_id,status)
         VALUES($1,$2,$3,'open') RETURNING id`,
        [interaction.guild.id, channel.id, interaction.user.id]
      );
      const ticketId = inserted.rows[0]?.id;
      if (!ticketId) {
        await channel.delete("Ticket database creation failed").catch(() => undefined);
        await interaction.reply({ content: "Не удалось создать тикет.", ephemeral: true });
        return;
      }

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🎫 Тикет #${ticketId}`)
            .setDescription("Опиши проблему. Staff сможет забрать тикет или закрыть его.")
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`dsp:ticket:claim:${ticketId}`)
              .setLabel("Забрать")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`dsp:ticket:close:${ticketId}`)
              .setLabel("Закрыть")
              .setStyle(ButtonStyle.Danger)
          )
        ]
      });

      await interaction.reply({ content: `Тикет создан: <#${channel.id}>.`, ephemeral: true });
    }
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:ticket:") || !interaction.guild) return;

    const [, , action, rawId] = interaction.customId.split(":");
    const ticketId = Number(rawId);
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
      await interaction.reply({ content: "Некорректный ticket id.", ephemeral: true }).catch(() => undefined);
      return;
    }

    const ticket = await this.db.query<{
      channel_id: string;
      creator_id: string;
      status: "open" | "closed";
      claimed_by: string | null;
    }>(
      "SELECT channel_id,creator_id,status,claimed_by FROM tickets WHERE id=$1 AND guild_id=$2",
      [ticketId, interaction.guild.id]
    );
    const row = ticket.rows[0];

    if (!row) {
      await interaction.reply({ content: "Тикет не найден.", ephemeral: true });
      return;
    }

    if (action === "claim") {
      if (!await this.canStaff(interaction, await this.config(interaction.guild.id))) {
        await interaction.reply({ content: "Кнопка доступна только staff.", ephemeral: true });
        return;
      }
      if (row.status !== "open") {
        await interaction.reply({ content: "Тикет уже закрыт.", ephemeral: true });
        return;
      }

      await this.db.query(
        "UPDATE tickets SET claimed_by=$1 WHERE id=$2 AND status='open'",
        [interaction.user.id, ticketId]
      );
      await interaction.reply({ content: "Тикет закреплён за тобой.", ephemeral: true });
      return;
    }

    if (action === "close") {
      const config = await this.config(interaction.guild.id);
      const staff = await this.canStaff(interaction, config);
      if (interaction.user.id !== row.creator_id && !staff) {
        await interaction.reply({ content: "Недостаточно прав.", ephemeral: true });
        return;
      }

      const channel = interaction.guild.channels.cache.get(row.channel_id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await this.db.query(
          "UPDATE tickets SET status='closed',closed_at=now() WHERE id=$1",
          [ticketId]
        );
        await interaction.reply({ content: "Канал тикета уже отсутствует; тикет закрыт.", ephemeral: true });
        return;
      }

      await interaction.reply({ content: "Закрываю тикет и сохраняю transcript.", ephemeral: true });
      const transcript = await this.transcript(channel);
      await this.db.query(
        `INSERT INTO ticket_transcripts(ticket_id,guild_id,content) VALUES($1,$2,$3)
         ON CONFLICT(ticket_id) DO UPDATE SET content=EXCLUDED.content`,
        [ticketId, interaction.guild.id, transcript]
      );
      await this.db.query(
        "UPDATE tickets SET status='closed',closed_at=now() WHERE id=$1",
        [ticketId]
      );

      if (config.transcriptChannelId) {
        const transcriptChannel = interaction.guild.channels.cache.get(config.transcriptChannelId);
        if (transcriptChannel?.isTextBased() && "send" in transcriptChannel) {
          const { AttachmentBuilder } = await import("discord.js");
          await transcriptChannel.send({
            content: `Transcript ticket #${ticketId}`,
            files: [new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: `ticket-${ticketId}.txt` })]
          }).catch(() => undefined);
        }
      }

      await channel.delete("Ticket closed").catch(() => undefined);
    }
  }

  private async canStaff(
    interaction: ButtonInteraction,
    config: TicketConfig
  ): Promise<boolean> {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    if (!config.staffRoleId || !interaction.member || !("roles" in interaction.member)) return false;
    const roles = interaction.member.roles;
    return Array.isArray(roles) ? roles.includes(config.staffRoleId) : roles.cache.has(config.staffRoleId);
  }

  private async transcript(channel: TextChannel): Promise<string> {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return "Transcript unavailable.";

    return [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((message) => `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag}: ${message.content}`)
      .join("\n");
  }
}
