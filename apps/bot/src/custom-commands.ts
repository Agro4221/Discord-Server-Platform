import {
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client
} from "discord.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./database.js";
import type { ModuleContext, PlatformModule } from "./module.js";
import { buildCommands } from "./discord/commands.js";
import { moduleEnabled } from "./module-utils.js";
import { logger } from "./logger.js";

export type CustomCommandAction = "response" | "alias" | "add_role" | "remove_role" | "toggle_role";

export type CustomCommandRecord = {
  id: number;
  guildId: string;
  name: string;
  aliases: string[];
  description: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  actionType: CustomCommandAction;
  response: string;
  aliasTarget: string | null;
  allowedRoleIds: string[];
  allowedChannelIds: string[];
  cooldownSeconds: number;
  roleId: string | null;
  discordCommandId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CustomCommandInput = {
  name: string;
  aliases?: string[];
  description?: string;
  enabled?: boolean;
  prefixEnabled?: boolean;
  slashEnabled?: boolean;
  actionType?: CustomCommandAction;
  response?: string;
  aliasTarget?: string | null;
  allowedRoleIds?: string[];
  allowedChannelIds?: string[];
  cooldownSeconds?: number;
  roleId?: string | null;
};

export class CustomCommandService implements PlatformModule {
  readonly name = "custom-commands";
  private unsubscribe?: () => void;
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig
  ) {}

  async init(context: ModuleContext): Promise<void> {
    const a = context.events.on("interaction.command", (interaction) => this.handleSlash(interaction));
    this.unsubscribe = () => a();
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cooldowns.clear();
  }

  async list(guildId: string): Promise<CustomCommandRecord[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,guild_id,name,aliases,description,enabled,prefix_enabled,slash_enabled,
              action_type,response,alias_target,allowed_role_ids,allowed_channel_ids,
              cooldown_seconds,role_id,discord_command_id,created_at,updated_at
       FROM custom_commands WHERE guild_id=$1 ORDER BY name ASC`,
      [guildId]
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async findPrefix(guildId: string, name: string): Promise<CustomCommandRecord | null> {
    if (!await moduleEnabled(this.db, guildId, "custom-commands", true)) return null;
    const normalized = normalizeName(name);
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,guild_id,name,aliases,description,enabled,prefix_enabled,slash_enabled,
              action_type,response,alias_target,allowed_role_ids,allowed_channel_ids,
              cooldown_seconds,role_id,discord_command_id,created_at,updated_at
       FROM custom_commands
       WHERE guild_id=$1 AND enabled=true AND prefix_enabled=true
         AND (name=$2 OR $2 = ANY(aliases))
       LIMIT 1`,
      [guildId, normalized]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async get(guildId: string, id: number): Promise<CustomCommandRecord | null> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,guild_id,name,aliases,description,enabled,prefix_enabled,slash_enabled,
              action_type,response,alias_target,allowed_role_ids,allowed_channel_ids,
              cooldown_seconds,role_id,discord_command_id,created_at,updated_at
       FROM custom_commands WHERE guild_id=$1 AND id=$2`,
      [guildId, id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(guildId: string, input: CustomCommandInput): Promise<CustomCommandRecord> {
    const normalized = validateInput(input);
    await this.assertNameFree(guildId, normalized.name);

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO custom_commands(
         guild_id,name,aliases,description,enabled,prefix_enabled,slash_enabled,
         action_type,response,alias_target,allowed_role_ids,allowed_channel_ids,cooldown_seconds,role_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        guildId,
        normalized.name,
        normalized.aliases,
        normalized.description,
        normalized.enabled,
        normalized.prefixEnabled,
        normalized.slashEnabled,
        normalized.actionType,
        normalized.response,
        normalized.aliasTarget,
        normalized.allowedRoleIds.join(","),
        normalized.allowedChannelIds.join(","),
        normalized.cooldownSeconds,
        normalized.roleId
      ]
    );

    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("custom_command_create_failed");

    try {
      await this.syncSlash(guildId, id);
    } catch (error) {
      await this.db.query("DELETE FROM custom_commands WHERE guild_id=$1 AND id=$2", [guildId, id]);
      throw error;
    }

    return (await this.get(guildId, id))!;
  }

  async update(guildId: string, id: number, input: CustomCommandInput): Promise<CustomCommandRecord | null> {
    const existing = await this.get(guildId, id);
    if (!existing) return null;

    const normalized = validateInput(input);
    const conflict = await this.db.query<{ id: string }>(
      "SELECT id FROM custom_commands WHERE guild_id=$1 AND name=$2 AND id<>$3 LIMIT 1",
      [guildId, normalized.name, id]
    );
    if (conflict.rows[0]) throw new Error("custom_command_name_taken");

    await this.db.query(
      `UPDATE custom_commands SET
         name=$3,aliases=$4,description=$5,enabled=$6,prefix_enabled=$7,slash_enabled=$8,
         action_type=$9,response=$10,alias_target=$11,allowed_role_ids=$12,
         allowed_channel_ids=$13,cooldown_seconds=$14,role_id=$15,updated_at=now()
       WHERE guild_id=$1 AND id=$2`,
      [
        guildId,
        id,
        normalized.name,
        normalized.aliases,
        normalized.description,
        normalized.enabled,
        normalized.prefixEnabled,
        normalized.slashEnabled,
        normalized.actionType,
        normalized.response,
        normalized.aliasTarget,
        normalized.allowedRoleIds.join(","),
        normalized.allowedChannelIds.join(","),
        normalized.cooldownSeconds,
        normalized.roleId
      ]
    );

    await this.syncSlash(guildId, id);
    return this.get(guildId, id);
  }

  async delete(guildId: string, id: number): Promise<boolean> {
    const existing = await this.get(guildId, id);
    if (!existing) return false;

    await this.deleteDiscordCommand(existing.discordCommandId, guildId);
    const result = await this.db.query(
      "DELETE FROM custom_commands WHERE guild_id=$1 AND id=$2",
      [guildId, id]
    );
    return result.rowCount === 1;
  }

  async canExecute(
    command: CustomCommandRecord,
    guildId: string,
    userId: string,
    roleIds: string[],
    channelId: string
  ): Promise<boolean> {
    if (!command.enabled) return false;
    if (command.allowedRoleIds.length && !command.allowedRoleIds.some((id) => roleIds.includes(id))) return false;
    if (command.allowedChannelIds.length && !command.allowedChannelIds.includes(channelId)) return false;

    const key = guildId + ":" + userId + ":" + command.id;
    const now = Date.now();
    const previous = this.cooldowns.get(key) ?? 0;
    if (command.cooldownSeconds > 0 && now - previous < command.cooldownSeconds * 1000) return false;
    this.cooldowns.set(key, now);

    if (this.cooldowns.size > 10_000) {
      for (const [keyName, timestamp] of this.cooldowns) {
        if (now - timestamp > 3_600_000) this.cooldowns.delete(keyName);
      }
    }
    return true;
  }

  render(command: CustomCommandRecord, vars: {
    user: string;
    mention: string;
    server: string;
    channel: string;
    args: string;
  }): string {
    return command.response
      .replaceAll("{user}", vars.user)
      .replaceAll("{mention}", vars.mention)
      .replaceAll("{server}", vars.server)
      .replaceAll("{channel}", vars.channel)
      .replaceAll("{args}", vars.args)
      .slice(0, 2000);
  }

  async handlePrefixCommand(
    message: import("discord.js").Message,
    command: CustomCommandRecord,
    args: string[]
  ): Promise<void> {
    if (!message.guild) return;

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    if (["add_role", "remove_role", "toggle_role"].includes(command.actionType)) {
      const role = command.roleId ? message.guild.roles.cache.get(command.roleId) : null;
      if (!role) {
        await message.reply("Роль для этой команды не настроена.");
        return;
      }
      if (role.managed || role.position >= (message.guild.members.me?.roles.highest.position ?? -1)) {
        await message.reply("Бот не может управлять этой ролью.");
        return;
      }
      if (command.actionType === "add_role") await member.roles.add(role);
      if (command.actionType === "remove_role") await member.roles.remove(role);
      if (command.actionType === "toggle_role") {
        if (member.roles.cache.has(role.id)) await member.roles.remove(role);
        else await member.roles.add(role);
      }
      await message.reply("✅ Роль обновлена: " + role.name);
      return;
    }

    if (command.actionType === "alias" && command.aliasTarget) {
      await message.reply("Alias-команды должны вызывать внутренний command router. Цель: " + command.aliasTarget);
      return;
    }

    await message.reply(this.render(command, {
      user: message.author.globalName ?? message.author.username,
      mention: "<@" + message.author.id + ">",
      server: message.guild.name,
      channel: "<#" + message.channelId + ">",
      args: args.join(" ")
    }));
  }

  private async handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return;
    const command = await this.findSlash(interaction.guildId!, interaction.commandName);
    if (!command) return;

    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    const allowed = await this.canExecute(
      command,
      interaction.guildId!,
      interaction.user.id,
      member?.roles.cache.map((role) => role.id) ?? [],
      interaction.channelId
    );
    if (!allowed) {
      await interaction.reply({ content: "Эта команда недоступна в текущем канале/для этой роли или cooldown ещё не закончился.", ephemeral: true });
      return;
    }

    if (["add_role", "remove_role", "toggle_role"].includes(command.actionType)) {
      const guildMember = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
      const role = command.roleId ? interaction.guild!.roles.cache.get(command.roleId) : null;
      if (!guildMember || !role) {
        await interaction.reply({ content: "Роль для этой команды не настроена.", ephemeral: true });
        return;
      }
      if (role.managed || role.position >= (interaction.guild!.members.me?.roles.highest.position ?? -1)) {
        await interaction.reply({ content: "Бот не может управлять этой ролью.", ephemeral: true });
        return;
      }
      if (command.actionType === "add_role") await guildMember.roles.add(role);
      if (command.actionType === "remove_role") await guildMember.roles.remove(role);
      if (command.actionType === "toggle_role") {
        if (guildMember.roles.cache.has(role.id)) await guildMember.roles.remove(role);
        else await guildMember.roles.add(role);
      }
      await interaction.reply({ content: "Роль обновлена: " + role.name, ephemeral: true });
      return;
    }

    if (command.actionType === "alias") {
      await interaction.reply({
        content: "Alias-команды подключаются к встроенным командам через единый command router. Для этого custom command использует target " + (command.aliasTarget ?? "unknown") + ".",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: this.render(command, {
        user: interaction.user.globalName ?? interaction.user.username,
        mention: "<@" + interaction.user.id + ">",
        server: interaction.guild!.name,
        channel: "<#" + interaction.channelId + ">",
        args: interaction.options.getString("args") ?? ""
      })
    });
  }

  private async findSlash(guildId: string, name: string): Promise<CustomCommandRecord | null> {
    if (!await moduleEnabled(this.db, guildId, "custom-commands", true)) return null;
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,guild_id,name,aliases,description,enabled,prefix_enabled,slash_enabled,
              action_type,response,alias_target,allowed_role_ids,allowed_channel_ids,
              cooldown_seconds,role_id,discord_command_id,created_at,updated_at
       FROM custom_commands
       WHERE guild_id=$1 AND name=$2 AND enabled=true AND slash_enabled=true
       LIMIT 1`,
      [guildId, normalizeName(name)]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private async assertNameFree(guildId: string, name: string): Promise<void> {
    const builtIn = new Set(buildCommands().map((command) => command.name));
    if (builtIn.has(name)) throw new Error("custom_command_name_conflicts_with_builtin");
    const result = await this.db.query<{ id: string }>(
      "SELECT id FROM custom_commands WHERE guild_id=$1 AND (name=$2 OR $2=ANY(aliases)) LIMIT 1",
      [guildId, name]
    );
    if (result.rows[0]) throw new Error("custom_command_name_taken");
  }

  private async syncSlash(guildId: string, id: number): Promise<void> {
    const command = await this.get(guildId, id);
    if (!command) return;

    if (this.config.botIdentityId !== "primary") return;

    if (!command.enabled || !command.slashEnabled) {
      await this.deleteDiscordCommand(command.discordCommandId, guildId);
      if (command.discordCommandId) {
        await this.db.query("UPDATE custom_commands SET discord_command_id=NULL,updated_at=now() WHERE guild_id=$1 AND id=$2", [guildId, id]);
      }
      return;
    }

    const builder = new SlashCommandBuilder()
      .setName(command.name)
      .setDescription(command.description || "Custom server command")
      .addStringOption((option) =>
        option.setName("args").setDescription("Optional command arguments")
      );

    const rest = new REST({ version: "10" }).setToken(this.config.discordToken);
    if (command.discordCommandId) {
      await rest.patch(
        Routes.applicationGuildCommand(this.config.discordClientId, guildId, command.discordCommandId),
        { body: builder.toJSON() }
      );
      return;
    }

    const created = await rest.post(
      Routes.applicationGuildCommands(this.config.discordClientId, guildId),
      { body: builder.toJSON() }
    ) as { id: string };

    await this.db.query(
      "UPDATE custom_commands SET discord_command_id=$3,updated_at=now() WHERE guild_id=$1 AND id=$2",
      [guildId, id, created.id]
    );
  }

  private async deleteDiscordCommand(commandId: string | null, guildId: string): Promise<void> {
    if (!commandId || this.config.botIdentityId !== "primary") return;
    const rest = new REST({ version: "10" }).setToken(this.config.discordToken);
    await rest.delete(
      Routes.applicationGuildCommand(this.config.discordClientId, guildId, commandId)
    ).catch((error) => {
      logger.warn("Custom slash command delete failed", { guildId, commandId, error: String(error) });
    });
  }

  private mapRow(row: Record<string, unknown>): CustomCommandRecord {
    const asStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

    const split = (value: unknown): string[] =>
      typeof value === "string" && value.trim() ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];

    return {
      id: Number(row.id),
      guildId: String(row.guild_id),
      name: String(row.name),
      aliases: asStringArray(row.aliases),
      description: String(row.description ?? ""),
      enabled: row.enabled === true,
      prefixEnabled: row.prefix_enabled === true,
      slashEnabled: row.slash_enabled === true,
      actionType: ["alias","add_role","remove_role","toggle_role"].includes(String(row.action_type)) ? row.action_type as CustomCommandAction : "response",
      response: String(row.response ?? ""),
      aliasTarget: typeof row.alias_target === "string" ? row.alias_target : null,
      allowedRoleIds: split(row.allowed_role_ids),
      allowedChannelIds: split(row.allowed_channel_ids),
      cooldownSeconds: Number(row.cooldown_seconds ?? 0),
      roleId: typeof row.role_id === "string" ? row.role_id : null,
      discordCommandId: typeof row.discord_command_id === "string" ? row.discord_command_id : null,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at))
    };
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function validateInput(input: CustomCommandInput): Required<Omit<CustomCommandInput, "aliasTarget">> & { aliasTarget: string | null } {
  const name = normalizeName(input.name);
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error("invalid_custom_command_name");

  const aliases = (input.aliases ?? []).map(normalizeName).filter(Boolean);
  if (aliases.some((alias) => !/^[a-z0-9_-]{1,32}$/.test(alias))) throw new Error("invalid_custom_command_alias");
  const builtIn = new Set(buildCommands().map((command) => command.name));
  if (builtIn.has(name) || aliases.some((alias) => builtIn.has(alias))) {
    throw new Error("custom_command_name_conflicts_with_builtin");
  }
  if (new Set([name, ...aliases]).size !== aliases.length + 1) throw new Error("duplicate_custom_command_alias");

  const description = (input.description ?? "").trim().slice(0, 100);
  const response = (input.response ?? "").slice(0, 2000);
  const actionType = input.actionType ?? "response";
  const aliasTarget = input.aliasTarget ? normalizeName(input.aliasTarget) : null;
  const roleId = input.roleId ? input.roleId : null;
  if (actionType === "response" && !response) throw new Error("custom_command_response_required");
  if (actionType === "alias" && !aliasTarget) throw new Error("custom_command_alias_target_required");
  if (["add_role","remove_role","toggle_role"].includes(actionType) && !/^\d{15,25}$/.test(roleId ?? "")) throw new Error("custom_command_role_target_required");

  const allowedRoleIds = (input.allowedRoleIds ?? []).filter((item) => /^\d{15,25}$/.test(item));
  const allowedChannelIds = (input.allowedChannelIds ?? []).filter((item) => /^\d{15,25}$/.test(item));
  const cooldownSeconds = Math.min(Math.max(Math.floor(input.cooldownSeconds ?? 0), 0), 86_400);

  return {
    name,
    aliases,
    description,
    enabled: input.enabled ?? true,
    prefixEnabled: input.prefixEnabled ?? true,
    slashEnabled: input.slashEnabled ?? false,
    actionType,
    response,
    aliasTarget,
    roleId,
    allowedRoleIds,
    allowedChannelIds,
    cooldownSeconds
  };
}
