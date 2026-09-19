import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Interaction
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

export class FormTickets implements PlatformModule {
  readonly name = "tickets";
  private unsubscribe?: () => void;

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); };
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "form") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "tickets", false)) {
      await interaction.reply({ content: "Модуль Tickets выключен.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId("dsp:form:ticket")
      .setTitle(interaction.options.getString("title")?.slice(0, 45) ?? "Support form")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("subject")
            .setLabel("Тема")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("details")
            .setLabel("Описание")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(2000)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isModalSubmit() || interaction.customId !== "dsp:form:ticket" || !interaction.guild) return;

    if (!await moduleEnabled(this.db, interaction.guild.id, "tickets", false)) {
      await interaction.reply({ content: "Tickets выключен.", ephemeral: true });
      return;
    }

    const subject = interaction.fields.getTextInputValue("subject");
    const details = interaction.fields.getTextInputValue("details");

    const config = await this.db.query<{ category_id: string | null }>(
      "SELECT category_id FROM ticket_settings WHERE guild_id=$1",
      [interaction.guild.id]
    );
    const categoryId = config.rows[0]?.category_id ?? undefined;

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`.slice(0, 90),
      type: 0,
      parent: categoryId,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: ["ViewChannel"] },
        {
          id: interaction.user.id,
          allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
        }
      ]
    });

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO tickets(guild_id,channel_id,creator_id,status)
       VALUES($1,$2,$3,'open') RETURNING id`,
      [interaction.guild.id, channel.id, interaction.user.id]
    );

    await channel.send(
      `🎫 **Тикет #${inserted.rows[0]?.id ?? "?"}**\n**Тема:** ${subject}\n\n${details}`
    );

    await interaction.reply({ content: `Тикет создан: <#${channel.id}>.`, ephemeral: true });
  }
}
