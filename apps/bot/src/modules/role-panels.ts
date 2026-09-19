import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";

type PanelRole = { roleId: string; label: string };

export class RolePanels implements PlatformModule {
  readonly name = "roles";
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
    if (!interaction.inGuild() || interaction.commandName !== "roles") return;
    if (!await moduleEnabled(this.db, interaction.guild.id, "roles", false)) {
      await interaction.reply({ content: "Модуль Role Panels выключен.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    const role = interaction.options.getRole("role", true);
    const label = interaction.options.getString("label", true);
    if (!channel.isTextBased()) {
      await interaction.reply({ content: "Channel должен быть текстовым.", ephemeral: true });
      return;
    }

    if (!interaction.guild.members.me?.permissions.has("ManageRoles")) {
      await interaction.reply({ content: "Боту не хватает Manage Roles.", ephemeral: true });
      return;
    }
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      await interaction.reply({ content: "Бот не может управлять этой ролью из-за role hierarchy.", ephemeral: true });
      return;
    }

    const created = await this.db.query<{ id: string }>(
      "INSERT INTO role_panels(guild_id,channel_id,title,roles) VALUES($1,$2,$3,$4::jsonb) RETURNING id",
      [interaction.guild.id, channel.id, "Выберите роли", JSON.stringify([{ roleId: role.id, label }])]
    );
    const panelId = created.rows[0]?.id;
    if (!panelId) throw new Error("role panel id missing");

    const message = await channel.send({
      content: "🎭 **Выберите роль**",
      components: [this.row(Number(panelId), [{ roleId: role.id, label }])]
    });

    await this.db.query(
      "UPDATE role_panels SET message_id=$1 WHERE id=$2",
      [message.id, panelId]
    );

    await interaction.reply({ content: "Панель ролей создана.", ephemeral: true });
  }

  private row(panelId: number, roles: PanelRole[]) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      roles.slice(0, 5).map((role) =>
        new ButtonBuilder()
          .setCustomId(`dsp:role:${panelId}:${role.roleId}`)
          .setLabel(role.label.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:role:") || !interaction.guild) return;

    const [, , panelRaw, roleId] = interaction.customId.split(":");
    const panelId = Number(panelRaw);
    if (!Number.isSafeInteger(panelId) || !roleId) return;

    const result = await this.db.query<{ guild_id: string; roles: { roleId: string; label: string }[] | null }>(
      "SELECT guild_id,roles FROM role_panels WHERE id=$1",
      [panelId]
    );
    const row = result.rows[0];
    if (!row || row.guild_id !== interaction.guild.id) {
      await interaction.reply({ content: "Панель не найдена.", ephemeral: true });
      return;
    }

    const allowed = Array.isArray(row.roles) && row.roles.some((entry) => entry?.roleId === roleId);
    if (!allowed) {
      await interaction.reply({ content: "Эта роль не входит в выбранную панель.", ephemeral: true });
      return;
    }

    const role = interaction.guild.roles.cache.get(roleId);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!role || role.position >= interaction.guild.members.me!.roles.highest.position) {
      await interaction.reply({ content: "Эта роль сейчас недоступна для управления.", ephemeral: true });
      return;
    }

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, "Role panel toggle");
      await interaction.reply({ content: `Роль ${role} снята.`, ephemeral: true });
    } else {
      await member.roles.add(role, "Role panel toggle");
      await interaction.reply({ content: `Роль ${role} выдана.`, ephemeral: true });
    }
  }
}
