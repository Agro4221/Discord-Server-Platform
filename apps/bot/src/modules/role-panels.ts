import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message
} from "discord.js";
import type { Database } from "../database.js";
import type { ModuleContext, PlatformModule } from "../module.js";
import { moduleEnabled } from "../module-utils.js";
import { logger } from "../logger.js";

export type PanelRole = { roleId: string; label: string };
export type RoleSelectionMode = "toggle" | "exclusive" | "max";
export type RolePanelRecord = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  roles: PanelRole[];
  selectionMode: RoleSelectionMode;
  maxSelections: number;
  durationMinutes: number;
};

type PanelMessageCallbacks = {
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, components: ActionRowBuilder<ButtonBuilder>[]) => Promise<string>;
};

export class RolePanels implements PlatformModule {
  readonly name = "roles";
  private unsubscribe?: () => void;
  private expiryTimer?: NodeJS.Timeout;
  private client?: ModuleContext["client"];

  constructor(private readonly db: Database) {}

  async init(context: ModuleContext): Promise<void> {
    this.client = context.client;
    const a = context.events.on("interaction.command", (interaction) => this.onCommand(interaction));
    const b = context.events.on("interaction", (interaction) => this.onInteraction(interaction));
    this.unsubscribe = () => { a(); b(); };
    this.expiryTimer = setInterval(() => void this.processExpiredAssignments(), 30_000);
    this.expiryTimer.unref();
    await this.processExpiredAssignments();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
    this.client = undefined;
  }

  async list(guildId: string): Promise<RolePanelRecord[]> {
    const result = await this.db.query<{ id: string; guild_id: string; channel_id: string; message_id: string | null; title: string; roles: PanelRole[]; selection_mode: RoleSelectionMode; max_selections: number; duration_minutes: number }>(
      "SELECT id,guild_id,channel_id,message_id,title,roles,selection_mode,max_selections,duration_minutes FROM role_panels WHERE guild_id=$1 ORDER BY id DESC",
      [guildId]
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      title: row.title,
      roles: Array.isArray(row.roles) ? row.roles : [],
      selectionMode: row.selection_mode ?? "toggle",
      maxSelections: Math.min(Math.max(Number(row.max_selections ?? 1), 1), 5),
      durationMinutes: Math.min(Math.max(Number(row.duration_minutes ?? 0), 0), 43200)
    }));
  }

  async createPanel(
    guildId: string,
    channelId: string,
    roles: PanelRole[],
    title = "Выберите роли",
    selectionMode: RoleSelectionMode = "toggle",
    maxSelections = 1,
    durationMinutes = 0,
    callbacks?: Pick<PanelMessageCallbacks, "deleteMessage" | "sendMessage">
  ): Promise<RolePanelRecord> {
    if (!roles.length || roles.length > 5) throw new Error("panel_requires_1_to_5_roles");
    const cleaned = [...new Map(
      roles
        .map((role) => ({ roleId: role.roleId, label: role.label.trim().slice(0,80) }))
        .filter((role) => role.roleId && role.label)
        .map((role) => [role.roleId, role])
    ).values()];
    if (!cleaned.length) throw new Error("panel_roles_empty");

    const normalizedMax = selectionMode === "max" ? Math.min(Math.max(Math.trunc(maxSelections), 1), cleaned.length) : 1;
    const normalizedDuration = Math.min(Math.max(Math.trunc(durationMinutes), 0), 43200);
    const result = await this.db.query<{ id: string }>(
      "INSERT INTO role_panels(guild_id,channel_id,title,roles,selection_mode,max_selections,duration_minutes) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING id",
      [guildId,channelId,title.trim().slice(0,100) || "Выберите роли",JSON.stringify(cleaned),selectionMode,normalizedMax,normalizedDuration]
    );
    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("role_panel_id_missing");

    let publishedMessageId: string | null = null;
    try {
      let panel = (await this.list(guildId)).find((entry) => entry.id === id);
      if (!panel) throw new Error("role_panel_not_found_after_create");

      if (callbacks) {
        publishedMessageId = await callbacks.sendMessage(
          channelId,
          "🎭 **" + panel.title + "**",
          [this.row(panel.id, panel.roles)]
        );
        await this.db.query(
          "UPDATE role_panels SET message_id=$1 WHERE id=$2 AND guild_id=$3",
          [publishedMessageId,id,guildId]
        );
        panel = { ...panel, messageId: publishedMessageId };
      }

      return panel;
    } catch (error) {
      if (publishedMessageId && callbacks) {
        await callbacks.deleteMessage(channelId,publishedMessageId).catch((deleteError) => {
          logger.warn("Role panel publication rollback message delete failed", {
            guildId,
            panelId: id,
            messageId: publishedMessageId,
            error: String(deleteError)
          });
        });
      }
      await this.db.query("DELETE FROM role_panels WHERE id=$1 AND guild_id=$2", [id,guildId])
        .catch((cleanupError) => {
          logger.error("Role panel publication rollback database cleanup failed", {
            guildId,
            panelId: id,
            error: String(cleanupError)
          });
        });
      logger.error("Role panel publication failed and was rolled back", {
        guildId,
        panelId: id,
        error: String(error)
      });
      throw error;
    }
  }

  async updatePanel(
    guildId: string,
    panelId: number,
    channelId: string,
    roles: PanelRole[],
    title: string,
    selectionMode: RoleSelectionMode = "toggle",
    maxSelections = 1,
    durationMinutes = 0,
    callbacks: PanelMessageCallbacks & {
      editMessage: (channelId: string, messageId: string, content: string, components: ActionRowBuilder<ButtonBuilder>[]) => Promise<void>;
    }
  ): Promise<RolePanelRecord | null> {
    if (!roles.length || roles.length > 5) throw new Error("panel_requires_1_to_5_roles");
    const cleaned = [...new Map(
      roles
        .map((role) => ({ roleId: role.roleId, label: role.label.trim().slice(0,80) }))
        .filter((role) => role.roleId && role.label)
        .map((role) => [role.roleId, role])
    ).values()];
    if (!cleaned.length) throw new Error("panel_roles_empty");

    const current = (await this.list(guildId)).find((panel) => panel.id === panelId);
    if (!current) return null;

    const nextTitle = title.trim().slice(0,100) || "Выберите роли";
    const content = "🎭 **" + nextTitle + "**";
    const components = [this.row(panelId, cleaned)];

    if (current.messageId && current.channelId === channelId) {
      await callbacks.editMessage(current.channelId, current.messageId, content, components);
      try {
        await this.db.query(
          "UPDATE role_panels SET title=$1,roles=$2::jsonb,selection_mode=$3,max_selections=$4,duration_minutes=$5 WHERE id=$6 AND guild_id=$7",
          [nextTitle,JSON.stringify(cleaned),selectionMode,selectionMode === "max" ? Math.min(Math.max(Math.trunc(maxSelections),1),cleaned.length) : 1,Math.min(Math.max(Math.trunc(durationMinutes),0),43200),panelId,guildId]
        );
      } catch (error) {
        await callbacks.editMessage(
          current.channelId,
          current.messageId,
          "🎭 **" + current.title + "**",
          [this.row(panelId, current.roles)]
        ).catch((rollbackError) => {
          logger.error("Role panel message rollback failed after database update error", {
            guildId,
            panelId,
            messageId: current.messageId,
            error: String(rollbackError)
          });
        });
        throw error;
      }
    } else {
      const newMessageId = await callbacks.sendMessage(channelId, content, components);
      try {
        await this.db.query(
          "UPDATE role_panels SET channel_id=$1,title=$2,roles=$3::jsonb,message_id=$4,selection_mode=$5,max_selections=$6,duration_minutes=$7 WHERE id=$8 AND guild_id=$9",
          [channelId,nextTitle,JSON.stringify(cleaned),newMessageId,selectionMode,selectionMode === "max" ? Math.min(Math.max(Math.trunc(maxSelections),1),cleaned.length) : 1,Math.min(Math.max(Math.trunc(durationMinutes),0),43200),panelId,guildId]
        );
      } catch (error) {
        await callbacks.deleteMessage(channelId,newMessageId).catch((deleteError) => {
          logger.warn("Role panel update rollback message delete failed", {
            guildId,
            panelId,
            messageId: newMessageId,
            error: String(deleteError)
          });
        });
        logger.error("Role panel database update failed after publication", {
          guildId,
          panelId,
          messageId: newMessageId,
          error: String(error)
        });
        throw error;
      }
      if (current.messageId) {
        await callbacks.deleteMessage(current.channelId,current.messageId).catch((error) => {
          logger.warn("Role panel old message cleanup failed", {
            guildId,
            panelId,
            messageId: current.messageId,
            error: String(error)
          });
        });
      }
    }

    return (await this.list(guildId)).find((panel) => panel.id === panelId) ?? null;
  }

  async deletePanel(guildId: string, panelId: number, deleteMessage: (channelId: string, messageId: string) => Promise<void>): Promise<boolean> {
    const result = await this.db.query<{ channel_id: string; message_id: string | null }>(
      "SELECT channel_id,message_id FROM role_panels WHERE id=$1 AND guild_id=$2",
      [panelId,guildId]
    );
    const row = result.rows[0];
    if (!row) return false;

    if (row.message_id) {
      await deleteMessage(row.channel_id,row.message_id).catch((error) => {
        logger.warn("Role panel Discord message delete failed", {
          guildId,
          panelId,
          messageId: row.message_id,
          error: String(error)
        });
      });
    }
    const deleted = await this.db.query(
      "DELETE FROM role_panels WHERE id=$1 AND guild_id=$2",
      [panelId,guildId]
    );
    return deleted.rowCount === 1;
  }

  async handlePrefixCommand(message: Message, commandName: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot || commandName !== "roles") return false;
    if (!await moduleEnabled(this.db, message.guild.id, "roles", false)) {
      await message.reply("Модуль Roles выключен.");
      return true;
    }
    if (!message.member?.permissions.has("ManageGuild")) {
      await message.reply("Нужны права Manage Server.");
      return true;
    }

    const roles = message.mentions.roles.map((role) => ({
      roleId: role.id,
      label: role.name
    })).slice(0,5);

    if (!roles.length) {
      await message.reply("Использование: !roles @Role1 @Role2 ...");
      return true;
    }

    const botMember = message.guild.members.me;
    if (!botMember?.permissions.has("ManageRoles")) {
      await message.reply("Боту не хватает Manage Roles.");
      return true;
    }
    for (const entry of roles) {
      const role = message.guild.roles.cache.get(entry.roleId);
      if (!role || role.managed || role.position >= botMember.roles.highest.position) {
        await message.reply("Одна из ролей недоступна из-за role hierarchy.");
        return true;
      }
    }

    await this.createPanel(message.guild.id, message.channelId, roles, args.join(" ").trim() || "Выберите роли", "toggle", 1, 0, {
      deleteMessage: async (channelId, messageId) => {
        const channel = message.guild!.channels.cache.get(channelId);
        if (channel && channel.type === 0) await channel.messages.delete(messageId).catch(() => undefined);
      },
      sendMessage: async (channelId, content, components) => {
        const channel = message.guild!.channels.cache.get(channelId);
        if (!channel || channel.type !== 0) throw new Error("role_panel_channel_missing");
        const sent = await channel.send({ content, components });
        return sent.id;
      }
    });

    await message.reply("🎭 Панель ролей опубликована.");
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

    const selectionMode = (interaction.options.getString("mode") as RoleSelectionMode | null) ?? "toggle";
    const maxSelections = interaction.options.getInteger("max-selections") ?? 1;
    const durationMinutes = interaction.options.getInteger("duration") ?? 0;
    await this.createPanel(guildId,channel.id,unique,"Выберите роли",selectionMode,maxSelections,durationMinutes,{
      deleteMessage: async (channelId, messageId) => {
        const target = interaction.guild!.channels.cache.get(channelId);
        if (!target || target.type !== 0) return;
        await target.messages.delete(messageId).catch((error) => {
          logger.warn("Role panel command cleanup message delete failed", {
            guildId,
            messageId,
            error: String(error)
          });
        });
      },
      sendMessage: async (channelId, content, components) => {
        const target = interaction.guild!.channels.cache.get(channelId);
        if (!target || target.type !== 0) throw new Error("role_panel_channel_missing");
        const message = await target.send({ content, components });
        return message.id;
      }
    });
    await interaction.reply({ content: "Панель ролей создана.", ephemeral: true });
  }

  private async processExpiredAssignments(): Promise<void> {
    if (!this.client) return;
    const result = await this.db.query<{
      guild_id: string;
      panel_id: string;
      user_id: string;
      role_id: string;
    }>(
      "DELETE FROM role_panel_assignments WHERE expires_at <= now() RETURNING guild_id,panel_id,user_id,role_id"
    );

    for (const assignment of result.rows) {
      const guild = this.client.guilds.cache.get(assignment.guild_id);
      const member = guild?.members.cache.get(assignment.user_id) ?? await guild?.members.fetch(assignment.user_id).catch(() => null);
      const role = guild?.roles.cache.get(assignment.role_id);
      if (!member || !role) continue;
      await member.roles.remove(role,"Timed role panel assignment expired").catch((error) => {
        logger.warn("Timed role expiration failed", {
          guildId: assignment.guild_id,
          panelId: assignment.panel_id,
          userId: assignment.user_id,
          roleId: assignment.role_id,
          error: String(error)
        });
      });
    }
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
    const result = await this.db.query<{ guild_id: string; roles: PanelRole[] | null; selection_mode: RoleSelectionMode; max_selections: number; duration_minutes: number }>(
      "SELECT guild_id,roles,selection_mode,max_selections,duration_minutes FROM role_panels WHERE id=$1",[panelId]
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
      await this.db.query(
        "DELETE FROM role_panel_assignments WHERE panel_id=$1 AND user_id=$2 AND role_id=$3",
        [panelId,interaction.user.id,role.id]
      );
      await interaction.reply({ content: "Роль " + role.name + " снята.", ephemeral: true });
      return;
    }

    const selected = Array.isArray(row.roles)
      ? row.roles.filter((entry) => member.roles.cache.has(entry.roleId)).map((entry) => entry.roleId)
      : [];

    if (row.selection_mode === "exclusive") {
      const removable = (row.roles ?? [])
        .map((entry) => interaction.guild!.roles.cache.get(entry.roleId))
        .filter((item): item is import("discord.js").Role => Boolean(item))
        .filter((item) => member.roles.cache.has(item.id) && item.id !== role.id);
      for (const current of removable) {
        if (current.position < bot.roles.highest.position) {
          await member.roles.remove(current,"Role panel exclusive selection");
        }
      }
    } else if (row.selection_mode === "max" && selected.length >= Math.max(1, Number(row.max_selections ?? 1))) {
      await interaction.reply({
        content: "Достигнут максимальный выбор ролей: " + Math.max(1, Number(row.max_selections ?? 1)) + ".",
        ephemeral: true
      });
      return;
    }

    await member.roles.add(role,"Role panel toggle");
    const durationMinutes = Math.min(Math.max(Number(row.duration_minutes ?? 0), 0), 43200);
    if (durationMinutes > 0) {
      await this.db.query(
        "INSERT INTO role_panel_assignments(guild_id,panel_id,user_id,role_id,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(mins => $5)) ON CONFLICT(panel_id,user_id,role_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",
        [interaction.guild.id,panelId,interaction.user.id,role.id,durationMinutes]
      );
    }
    await interaction.reply({
      content: "Роль " + role.name + " выдана." + (durationMinutes > 0 ? " Время действия: " + durationMinutes + " мин." : ""),
      ephemeral: true
    });
  }
}
