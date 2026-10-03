import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Message,
  type PermissionResolvable
} from "discord.js";
import type { Database } from "./database.js";

export type CommandPolicyRecord = {
  guildId: string;
  commandName: string;
  enabled: boolean;
  prefixEnabled: boolean;
  slashEnabled: boolean;
  cooldownSeconds: number;
  allowedRoleIds: string[];
  deniedRoleIds: string[];
  allowedChannelIds: string[];
  deniedChannelIds: string[];
  helpVisible: boolean;
};

export type CommandDefinition = {
  name: string;
  label: string;
  module: string;
  requiredPermission?: PermissionResolvable;
  prefix: boolean;
  slash: boolean;
};

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  { name: "help", label: "Help", module: "system", prefix: true, slash: true },
  { name: "ping", label: "Ping", module: "system", prefix: false, slash: true },
  { name: "serverinfo", label: "Server info", module: "system", prefix: true, slash: true },
  { name: "userinfo", label: "User info", module: "system", prefix: true, slash: true },
  { name: "roleinfo", label: "Role info", module: "system", prefix: true, slash: true },
  { name: "channelinfo", label: "Channel info", module: "system", prefix: true, slash: true },
  { name: "embed", label: "Embed Builder", module: "system", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: false, slash: true },
  { name: "level", label: "Level", module: "leveling", prefix: true, slash: true },
  { name: "rank", label: "Rank", module: "leveling", prefix: true, slash: true },
  { name: "top", label: "Top", module: "leveling", prefix: true, slash: true },
  { name: "stats", label: "Server statistics", module: "analytics", prefix: false, slash: true },
  { name: "poll", label: "Polls", module: "polls", prefix: true, slash: true },
  { name: "suggestion", label: "Suggestions", module: "polls", prefix: true, slash: true },
  { name: "invites", label: "Invite statistics", module: "invite-tracking", prefix: true, slash: true },
  { name: "achievements", label: "Achievements", module: "birthdays", prefix: true, slash: true },
  { name: "birthday", label: "Birthdays", module: "birthdays", prefix: true, slash: true },
  { name: "rep", label: "Reputation", module: "reputation", prefix: true, slash: true },
  { name: "profile", label: "Profile", module: "reputation", prefix: true, slash: true },
  { name: "history", label: "Moderation history", module: "moderation", requiredPermission: PermissionFlagsBits.ModerateMembers, prefix: true, slash: false },
  { name: "clear", label: "Clear messages", module: "moderation", requiredPermission: PermissionFlagsBits.ManageMessages, prefix: true, slash: true },
  { name: "slowmode", label: "Slowmode", module: "moderation", requiredPermission: PermissionFlagsBits.ManageChannels, prefix: true, slash: true },
  { name: "lock", label: "Lock channel", module: "moderation", requiredPermission: PermissionFlagsBits.ManageChannels, prefix: true, slash: true },
  { name: "unlock", label: "Unlock channel", module: "moderation", requiredPermission: PermissionFlagsBits.ManageChannels, prefix: true, slash: true },
  { name: "ban", label: "Ban", module: "moderation", requiredPermission: PermissionFlagsBits.BanMembers, prefix: true, slash: true },
  { name: "unban", label: "Unban", module: "moderation", requiredPermission: PermissionFlagsBits.BanMembers, prefix: true, slash: true },
  { name: "kick", label: "Kick", module: "moderation", requiredPermission: PermissionFlagsBits.KickMembers, prefix: true, slash: true },
  { name: "timeout", label: "Timeout", module: "moderation", requiredPermission: PermissionFlagsBits.ModerateMembers, prefix: true, slash: true },
  { name: "warn", label: "Warn", module: "moderation", requiredPermission: PermissionFlagsBits.ModerateMembers, prefix: true, slash: true },
  { name: "moderate", label: "Moderation command group", module: "moderation", requiredPermission: PermissionFlagsBits.ModerateMembers, prefix: false, slash: true },
  { name: "setup", label: "Server setup", module: "server", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: false, slash: true },
  { name: "automod", label: "AutoMod", module: "automod", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "welcome", label: "Welcome", module: "welcome", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "security", label: "Security", module: "security", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "verify", label: "Verification", module: "verification", prefix: true, slash: true },
  { name: "ticket", label: "Tickets", module: "tickets", prefix: true, slash: true },
  { name: "roles", label: "Role panels", module: "roles", requiredPermission: PermissionFlagsBits.ManageRoles, prefix: true, slash: true },
  { name: "giveaway", label: "Giveaways", module: "giveaways", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "economy", label: "Economy", module: "economy", prefix: true, slash: true },
  { name: "shop", label: "Economy shop", module: "economy", prefix: true, slash: true },
  { name: "afk", label: "AFK / Away", module: "reminders", prefix: true, slash: true },
  { name: "remind", label: "Reminder", module: "reminders", prefix: true, slash: true },
  { name: "schedule", label: "Scheduled message", module: "reminders", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "sticky", label: "Sticky message", module: "reminders", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "starboard", label: "Starboard", module: "starboard", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "analytics", label: "Analytics", module: "analytics", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: false, slash: true },
  { name: "feed", label: "Notifications", module: "notifications", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true },
  { name: "streamalert", label: "Stream alerts", module: "notifications", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: false, slash: true },
  { name: "music", label: "Music group", module: "music", prefix: true, slash: true },
  { name: "play", label: "Play", module: "music", prefix: true, slash: true },
  { name: "pause", label: "Pause", module: "music", prefix: true, slash: true },
  { name: "resume", label: "Resume", module: "music", prefix: true, slash: true },
  { name: "skip", label: "Skip", module: "music", prefix: true, slash: true },
  { name: "stop", label: "Stop", module: "music", prefix: true, slash: true },
  { name: "shuffle", label: "Shuffle", module: "music", prefix: true, slash: true },
  { name: "queue", label: "Queue", module: "music", prefix: true, slash: true },
  { name: "playlist", label: "Playlist", module: "music", prefix: true, slash: true },
  { name: "nowplaying", label: "Now Playing", module: "music", prefix: true, slash: true },
  { name: "previous", label: "Previous", module: "music", prefix: true, slash: true },
  { name: "lyrics", label: "Lyrics", module: "music", prefix: true, slash: true },
  { name: "favorite", label: "Favorite", module: "music", prefix: false, slash: true },
  { name: "filter", label: "Filter", module: "music", prefix: false, slash: true },
  { name: "queue-policy", label: "Queue access policy", module: "music", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: false, slash: true },
  { name: "247", label: "24/7", module: "music", prefix: false, slash: true },
  { name: "providers", label: "Music providers", module: "music", prefix: false, slash: true },
  { name: "repeat", label: "Repeat", module: "music", prefix: true, slash: true },
  { name: "seek", label: "Seek", module: "music", prefix: true, slash: true },
  { name: "volume", label: "Volume", module: "music", prefix: true, slash: true },
  { name: "autoplay", label: "Autoplay", module: "music", prefix: true, slash: true },
  { name: "balance", label: "Balance", module: "economy", prefix: true, slash: false },
  { name: "daily", label: "Daily", module: "economy", prefix: true, slash: false },
  { name: "leaderboard", label: "Economy leaderboard", module: "economy", prefix: true, slash: false },
  { name: "pay", label: "Pay", module: "economy", prefix: true, slash: false },
  { name: "shop", label: "Shop", module: "economy", prefix: true, slash: false },
  { name: "buy", label: "Buy", module: "economy", prefix: true, slash: false },
  { name: "automation", label: "Automation", module: "automation", requiredPermission: PermissionFlagsBits.ManageGuild, prefix: true, slash: true }
];

export class CommandPolicyService {
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly db: Database) {}

  async list(guildId: string): Promise<Array<CommandPolicyRecord & { label: string; module: string; defaultPrefix: boolean; defaultSlash: boolean }>> {
    const result = await this.db.query<{
      command_name: string;
      enabled: boolean;
      prefix_enabled: boolean;
      slash_enabled: boolean;
      cooldown_seconds: number;
      allowed_role_ids: string[];
      denied_role_ids: string[];
      allowed_channel_ids: string[];
      denied_channel_ids: string[];
      help_visible: boolean;
    }>(
      "SELECT command_name,enabled,prefix_enabled,slash_enabled,cooldown_seconds,allowed_role_ids,denied_role_ids,allowed_channel_ids,denied_channel_ids,help_visible FROM command_policies WHERE guild_id=$1 ORDER BY command_name",
      [guildId]
    );
    const stored = new Map(result.rows.map((row) => [row.command_name, row]));
    return COMMAND_DEFINITIONS.map((definition) => {
      const row = stored.get(definition.name);
      return {
        guildId,
        commandName: definition.name,
        label: definition.label,
        module: definition.module,
        enabled: row?.enabled ?? true,
        prefixEnabled: row?.prefix_enabled ?? definition.prefix,
        slashEnabled: row?.slash_enabled ?? definition.slash,
        cooldownSeconds: row?.cooldown_seconds ?? 0,
        allowedRoleIds: row?.allowed_role_ids ?? [],
        deniedRoleIds: row?.denied_role_ids ?? [],
        allowedChannelIds: row?.allowed_channel_ids ?? [],
        deniedChannelIds: row?.denied_channel_ids ?? [],
        helpVisible: row?.help_visible ?? true,
        defaultPrefix: definition.prefix,
        defaultSlash: definition.slash
      };
    });
  }

  async set(guildId: string, commandName: string, patch: Partial<Omit<CommandPolicyRecord, "guildId" | "commandName">>): Promise<void> {
    const definition = COMMAND_DEFINITIONS.find((item) => item.name === commandName);
    if (!definition) throw new Error("unknown_command");

    const current = await this.get(guildId, commandName);
    const next = {
      enabled: patch.enabled ?? current.enabled,
      prefixEnabled: patch.prefixEnabled ?? current.prefixEnabled,
      slashEnabled: patch.slashEnabled ?? current.slashEnabled,
      cooldownSeconds: clampInt(patch.cooldownSeconds ?? current.cooldownSeconds, 0, 86400),
      allowedRoleIds: cleanIds(patch.allowedRoleIds ?? current.allowedRoleIds),
      deniedRoleIds: cleanIds(patch.deniedRoleIds ?? current.deniedRoleIds),
      allowedChannelIds: cleanIds(patch.allowedChannelIds ?? current.allowedChannelIds),
      deniedChannelIds: cleanIds(patch.deniedChannelIds ?? current.deniedChannelIds),
      helpVisible: patch.helpVisible ?? current.helpVisible
    };

    await this.db.query(
      "INSERT INTO command_policies(guild_id,command_name,enabled,prefix_enabled,slash_enabled,cooldown_seconds,allowed_role_ids,denied_role_ids,allowed_channel_ids,denied_channel_ids,help_visible) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(guild_id,command_name) DO UPDATE SET enabled=EXCLUDED.enabled,prefix_enabled=EXCLUDED.prefix_enabled,slash_enabled=EXCLUDED.slash_enabled,cooldown_seconds=EXCLUDED.cooldown_seconds,allowed_role_ids=EXCLUDED.allowed_role_ids,denied_role_ids=EXCLUDED.denied_role_ids,allowed_channel_ids=EXCLUDED.allowed_channel_ids,denied_channel_ids=EXCLUDED.denied_channel_ids,help_visible=EXCLUDED.help_visible,updated_at=now()",
      [
        guildId,
        commandName,
        next.enabled,
        next.prefixEnabled,
        next.slashEnabled,
        next.cooldownSeconds,
        next.allowedRoleIds,
        next.deniedRoleIds,
        next.allowedChannelIds,
        next.deniedChannelIds,
        next.helpVisible
      ]
    );
  }

  async get(guildId: string, commandName: string): Promise<CommandPolicyRecord> {
    const definition = COMMAND_DEFINITIONS.find((item) => item.name === commandName);
    const result = await this.db.query<{
      enabled: boolean;
      prefix_enabled: boolean;
      slash_enabled: boolean;
      cooldown_seconds: number;
      allowed_role_ids: string[];
      denied_role_ids: string[];
      allowed_channel_ids: string[];
      denied_channel_ids: string[];
      help_visible: boolean;
    }>(
      "SELECT enabled,prefix_enabled,slash_enabled,cooldown_seconds,allowed_role_ids,denied_role_ids,allowed_channel_ids,denied_channel_ids,help_visible FROM command_policies WHERE guild_id=$1 AND command_name=$2",
      [guildId,commandName]
    );
    let row = result.rows[0];
    if (!row && commandName.includes(".")) {
      const root = commandName.split(".")[0] ?? commandName;
      const rootResult = await this.db.query<typeof result.rows[number]>(
        "SELECT enabled,prefix_enabled,slash_enabled,cooldown_seconds,allowed_role_ids,denied_role_ids,allowed_channel_ids,denied_channel_ids,help_visible FROM command_policies WHERE guild_id=$1 AND command_name=$2",
        [guildId,root]
      );
      row = rootResult.rows[0];
    }

    return {
      guildId,
      commandName,
      enabled: row?.enabled ?? true,
      prefixEnabled: row?.prefix_enabled ?? definition?.prefix ?? true,
      slashEnabled: row?.slash_enabled ?? definition?.slash ?? true,
      cooldownSeconds: row?.cooldown_seconds ?? 0,
      allowedRoleIds: row?.allowed_role_ids ?? [],
      deniedRoleIds: row?.denied_role_ids ?? [],
      allowedChannelIds: row?.allowed_channel_ids ?? [],
      deniedChannelIds: row?.denied_channel_ids ?? [],
      helpVisible: row?.help_visible ?? true
    };
  }

  async checkInteraction(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.inGuild()) return true;
    const key = commandKey(interaction);
    const policy = await this.get(interaction.guildId!, key);
    const definition = COMMAND_DEFINITIONS.find((item) => item.name === key) ?? COMMAND_DEFINITIONS.find((item) => item.name === interaction.commandName);

    if (!policy.enabled || !policy.slashEnabled) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Эта команда отключена для сервера.", ephemeral: true });
      }
      return false;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return false;

    const moderatorOverride = definition?.module === "moderation" && await this.hasModeratorRole(interaction.guildId!, member);
    if (definition?.requiredPermission && !moderatorOverride && !member.permissions.has(definition.requiredPermission)) {
      await interaction.reply({ content: "У тебя нет необходимых прав для этой команды.", ephemeral: true });
      return false;
    }

    if (!passesScope(policy, member.roles.cache.map((role) => role.id), interaction.channelId)) {
      await interaction.reply({ content: "Команда недоступна в этом канале или для этой роли.", ephemeral: true });
      return false;
    }

    return this.acquireCooldown(policy, interaction.guildId!, interaction.user.id);
  }

  async checkMessage(message: Message, commandName: string): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;
    const policy = await this.get(message.guild.id, commandName);
    if (!policy.enabled || !policy.prefixEnabled) return false;

    const member = message.member;
    const definition = COMMAND_DEFINITIONS.find((item) => item.name === commandName);
    const moderatorOverride = definition?.module === "moderation" && await this.hasModeratorRole(message.guild.id, member ?? undefined);
    if (definition?.requiredPermission && !moderatorOverride && !member?.permissions.has(definition.requiredPermission)) {
      await message.reply("У тебя нет необходимых прав для этой команды.");
      return false;
    }

    if (!passesScope(policy, member?.roles.cache.map((role) => role.id) ?? [], message.channelId)) {
      await message.reply("Команда недоступна в этом канале или для этой роли.");
      return false;
    }

    return this.acquireCooldown(policy, message.guild.id, message.author.id);
  }

  private async hasModeratorRole(
    guildId: string,
    member: import("discord.js").GuildMember | undefined
  ): Promise<boolean> {
    if (!member) return false;
    const result = await this.db.query<{ moderator_role_ids: string }>(
      "SELECT moderator_role_ids FROM guild_settings WHERE guild_id=$1",
      [guildId]
    );
    const roles = (result.rows[0]?.moderator_role_ids ?? "").split(/[,\s]+/).filter(Boolean);
    return roles.some((roleId) => member.roles.cache.has(roleId));
  }

  async commandKeyFor(interaction: ChatInputCommandInteraction): Promise<string> {
    return commandKey(interaction);
  }

  async shutdown(): Promise<void> {
    this.cooldowns.clear();
  }

  private acquireCooldown(policy: CommandPolicyRecord, guildId: string, userId: string): boolean {
    if (policy.cooldownSeconds <= 0) return true;
    const key = guildId + ":" + userId + ":" + policy.commandName;
    const now = Date.now();
    const previous = this.cooldowns.get(key) ?? 0;
    if (now - previous < policy.cooldownSeconds * 1000) return false;
    this.cooldowns.set(key, now);
    return true;
  }
}

function commandKey(interaction: ChatInputCommandInteraction): string {
  try {
    const subcommand = interaction.options.getSubcommand(false);
    return subcommand ? interaction.commandName + "." + subcommand : interaction.commandName;
  } catch {
    return interaction.commandName;
  }
}

function passesScope(policy: CommandPolicyRecord, roleIds: string[], channelId: string): boolean {
  if (policy.deniedRoleIds.some((id) => roleIds.includes(id))) return false;
  if (policy.deniedChannelIds.includes(channelId)) return false;
  if (policy.allowedRoleIds.length && !policy.allowedRoleIds.some((id) => roleIds.includes(id))) return false;
  if (policy.allowedChannelIds.length && !policy.allowedChannelIds.includes(channelId)) return false;
  return true;
}

function cleanIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => /^\d{15,25}$/.test(value)))].slice(0, 100);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}
