export type AutomationEvent =
  | "member.join"
  | "member.leave"
  | "member.role.add"
  | "member.role.remove"
  | "message.create"
  | "message.delete"
  | "message.edit"
  | "reaction.add"
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
  | { type: "channel-is"; channelId: string }
  | { type: "cooldown-clear"; key: string };

export type AutomationAction =
  | { type: "send-message"; channelId: string; content: string }
  | { type: "dm-user"; userId: string; content: string }
  | { type: "add-role"; userId: string; roleId: string }
  | { type: "remove-role"; userId: string; roleId: string }
  | { type: "timeout"; userId: string; durationSeconds: number; reason: string }
  | { type: "delete-message"; channelId: string; messageId: string }
  | { type: "log"; message: string };

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
