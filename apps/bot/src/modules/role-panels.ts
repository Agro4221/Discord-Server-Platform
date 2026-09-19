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

export type PanelRole = { roleId: string; label: string };
export type RolePanelRecord = { id: number; guildId: string; channelId: string; messageId: string | null; title: string; roles: PanelRole[] };

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

  async list(guildId: string): Promise<RolePanelRecord[]> {
    const result = await this.db.query<{ id: string; guild_id: string; channel_id: string; message_id: string | null; title: string; roles: PanelRole[] }>(
      "SELECT id,guild_id,channel_id,message_id,title,roles FROM role_panels WHERE guild_id=$1 ORDER BY id DESC",
      [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      title: row.title,
      roles: Array.isArray(row.roles) ? row.roles : []
    }));
  }

  async createPanel(guildId: string, channelId: string, roles: PanelRole[], title = "Выберите роли"): Promise<RolePanelRecord> {
    if (!roles.length || roles.length > 5) throw new Error("panel_requires_1_to_5_roles");
    const cleaned = roles.map((role) => ({ roleId: role.roleId, label: role.label.trim().slice(0,80) })).filter((role) => role.roleId && role.label);
    if (!cleaned.length) throw new Error("panel_roles_empty");
    const result = await this.db.query<{ id: string }>(
      "INSERT INTO role_panels(guild_id,channel_id,title,roles) VALUES($1,$2,$3,$4::jsonb) RETURNING id",
      [guildId,channelId,title.slice(0,100),JSON.stringify(cleaned)]
    );
    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("role_panel_id_missing");
    return (await this.list(guildId)).find((panel) => panel.id === id)!;
  }

  async deletePanel(guildId: string, panelId: number, deleteMessage: (channelId: string, messageId: string) => Promise<void>): Promise<boolean> {
    const result = await this.db.query<{ channel_id: string; message_id: string | null }>(
      "DELETE FROM role_panels WHERE id=$1 AND guild_id=$2 RETURNING channel_id,message_id",
      [panelId,guildId]
    );
    const row = result.rows[0];
    if (!row) return false;
    if (row.message_id) await deleteMessage(row.channel_id,row.message_id);
    return true;
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || interaction.commandName !== "roles") return;
    const guildId = interaction.guild!.id;
    if (!await moduleEnabled(this.db, guildId, "roles", false)) {
      await interaction.reply({ content: "Модуль Role Panels выключен.", ephemeral: true });
      return;
    }
    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await interaction.reply({ content: "Нужны права Manage Server.", ephemeral: true });
      return;
    }
    if (interaction.options.getSubcommand() !== "panel") return;

    const channelOption = interaction.options.getChannel("channel", true);
    const channel = interaction.guild!.channels.cache.get(channelOption.id);
    if (!channel || channel.type !== 0) {
      await interaction.reply({ content: "Channel должен быть текстовым.", ephemeral: true });
      return;
    }

    const botMember = interaction.guild!.members.me;
    if (!botMember?.permissions.has("ManageRoles")) {
      await interaction.reply({ content: "Боту не хватает Manage Roles.", ephemeral: true });
      return;
    }

    const requested: PanelRole[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const role = interaction.options.getRole(index === 1 ? "role" : ("role" + index) as "role2" );
      if (!role) continue;
      const label = interaction.options.getString(index === 1 ? "label" : ("label" + index) as "label2") ?? role.name;
      requested.push({ roleId: role.id, label });
    }
    const unique = [...new Map(requested.map((role) => [role.roleId, role])).values()];
    for (const entry of unique) {
      const role = interaction.guild!.roles.cache.get(entry.roleId);
      if (!role || role.position >= botMember.roles.highest.position) {
        await interaction.reply({ content: "Одна из выбранных ролей недоступна из-за role hierarchy.", ephemeral: true });
        return;
      }
    }

    const panel = await this.createPanel(guildId,channel.id,unique);
    const message = await channel.send({
      content: "🎭 **" + panel.title + "**",
      components: [this.row(panel.id,unique)]
    });
    await this.db.query("UPDATE role_panels SET message_id=$1 WHERE id=$2", [message.id,panel.id]);
    await interaction.reply({ content: "Панель ролей создана.", ephemeral: true });
  }

  private row(panelId: number, roles: PanelRole[]) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      roles.slice(0,5).map((role) => new ButtonBuilder()
        .setCustomId("dsp:role:" + panelId + ":" + role.roleId)
        .setLabel(role.label.slice(0,80))
        .setStyle(ButtonStyle.Secondary))
    );
  }

  private async onInteraction(interaction: import("discord.js").Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith("dsp:role:") || !interaction.guild) return;
    const [, , panelRaw, roleId] = interaction.customId.split(":");
    const panelId = Number(panelRaw);
    if (!Number.isSafeInteger(panelId) || !roleId) return;
    const result = await this.db.query<{ guild_id: string; roles: PanelRole[] | null }>(
      "SELECT guild_id,roles FROM role_panels WHERE id=$1",[panelId]
    );
    const row = result.rows[0];
    if (!row || row.guild_id !== interaction.guild.id) { await interaction.reply({ content: "Панель не найдена.", ephemeral: true }); return; }
    const allowed = Array.isArray(row.roles) && row.roles.some((entry) => entry.roleId === roleId);
    if (!allowed) { await interaction.reply({ content: "Эта роль не входит в выбранную панель.", ephemeral: true }); return; }
    const role = interaction.guild.roles.cache.get(roleId);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const bot = interaction.guild.members.me;
    if (!role || !bot?.roles.highest || role.position >= bot.roles.highest.position) { await interaction.reply({ content: "Эта роль сейчас недоступна.", ephemeral: true }); return; }
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role,"Role panel toggle");
      await interaction.reply({ content: "Роль " + role.name + " снята.", ephemeral: true });
    } else {
      await member.roles.add(role,"Role panel toggle");
      await interaction.reply({ content: "Роль " + role.name + " выдана.", ephemeral: true });
    }
  }
}
