import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type PermissionResolvable
} from "discord.js";

export class PermissionChecker {
  constructor(private readonly guild: Guild) {}

  memberHas(member: GuildMember | { permissions: { has: (permission: PermissionResolvable) => boolean } }, permission: bigint): boolean {
    return member.permissions.has(permission);
  }

  botMissing(permissions: PermissionResolvable[]): PermissionResolvable[] {
    const me = this.guild.members.me;
    if (!me) return permissions;
    return permissions.filter((permission) => !me.permissions.has(permission));
  }

  botCan(permission: PermissionResolvable): boolean {
    const me = this.guild.members.me;
    if (!me) return false;
    return me.permissions.has(permission);
  }

  static requiredForTemporaryVoice(): bigint[] {
    return [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.MoveMembers
    ];
  }
}
