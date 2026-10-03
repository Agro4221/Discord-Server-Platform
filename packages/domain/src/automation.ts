export type AutomationEvent =
  | "member.join"
  | "member.leave"
  | "member.role.add"
  | "member.role.remove"
  | "message.create"
  | "message.delete"
  | "message.edit"
  | "reaction.add"
  | "reaction.remove"
  | "channel.delete"
  | "role.delete"
  | "member.ban"
  | "voice.join"
  | "voice.leave"
  | "voice.move"
  | "moderation.case"
  | "ticket.create"
  | "ticket.close"
  | "giveaway.end"
  | "schedule";

export type AutomationCondition =
  | { type: "equals"; left: string; right: string }
  | { type: "contains"; left: string; right: string }
  | { type: "matches"; left: string; pattern: string }
  | { type: "number-gte"; left: string; right: number }
  | { type: "number-lte"; left: string; right: number }
  | { type: "has-role"; userId: string; roleId: string }
  | { type: "not-has-role"; userId: string; roleId: string }
  | { type: "channel-is"; channelId: string }
  | { type: "channel-type-is"; channelType: AutomationChannelType }
  | { type: "user-is-bot"; userId: string; value: boolean }
  | { type: "has-permission"; userId: string; permission: AutomationPermission }
  | { type: "cooldown-clear"; key: string };

export type AutomationChannelType =
  | "text"
  | "announcement"
  | "forum"
  | "voice"
  | "stage"
  | "category"
  | "thread"
  | "other";

export type AutomationPermission =
  | "Administrator"
  | "ManageGuild"
  | "ManageChannels"
  | "ManageRoles"
  | "ManageMessages"
  | "KickMembers"
  | "BanMembers"
  | "ModerateMembers";

export type AutomationAction =
  | { type: "send-message"; channelId: string; content: string }
  | { type: "dm-user"; userId: string; content: string }
  | { type: "add-role"; userId: string; roleId: string }
  | { type: "remove-role"; userId: string; roleId: string }
  | { type: "timeout"; userId: string; durationSeconds: number; reason: string }
  | { type: "warn"; userId: string; reason: string }
  | { type: "kick"; userId: string; reason: string }
  | { type: "ban"; userId: string; durationMinutes?: number; reason: string }
  | { type: "delete-message"; channelId: string; messageId: string }
  | { type: "set-nickname"; userId: string; nickname: string | null }
  | { type: "react-message"; channelId: string; messageId: string; emoji: string }
  | { type: "log"; message: string }
  | { type: "delay"; seconds: number }
  | { type: "webhook"; url: string; content: string }
  | { type: "branch"; condition: AutomationCondition; thenActions: AutomationAction[]; elseActions: AutomationAction[] };

export type AutomationRule = {
  id: string;
  guildId: string;
  name: string;
  enabled: boolean;
  event: AutomationEvent;
  all: AutomationCondition[];
  any: AutomationCondition[];
  actions: AutomationAction[];
};
