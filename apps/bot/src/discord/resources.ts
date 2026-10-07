import {
  ChannelType,
  type Client,
  PermissionFlagsBits
} from "discord.js";

export function guildResources(client: Client, guildId: string) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("guild_not_found");

  const botMember = guild.members.me;
  const permissionNames = [
    "ViewChannel",
    "SendMessages",
    "ManageMessages",
    "ManageChannels",
    "ManageRoles",
    "KickMembers",
    "BanMembers",
    "ModerateMembers",
    "Connect",
    "Speak",
    "MoveMembers",
    "EmbedLinks",
    "AttachFiles",
    "ReadMessageHistory",
    "ManageWebhooks"
  ] as const;

  const botPermissions = Object.fromEntries(
    permissionNames.map((name) => [name, Boolean(botMember?.permissions.has(PermissionFlagsBits[name]))])
  );

  return {
    bot: botMember ? {
      id: botMember.id,
      tag: botMember.user.tag,
      highestRole: {
        id: botMember.roles.highest.id,
        name: botMember.roles.highest.name,
        position: botMember.roles.highest.position
      },
      permissions: botPermissions
    } : null,
    channels: [...guild.channels.cache.values()]
      .filter((channel) =>
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildCategory
        ].includes(channel.type)
      )
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: "parentId" in channel ? channel.parentId : null
      }))
      .sort((a, b) => a.type - b.type || a.name.localeCompare(b.name)),
    roles: [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id && role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        position: role.position,
        manageable: Boolean(
          guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) &&
          guild.members.me?.roles.highest.position > role.position
        )
      }))
  };
}
