export type ServerModuleKey =
  | "moderation"
  | "automod"
  | "security"
  | "temporary-voice"
  | "welcome"
  | "verification"
  | "roles"
  | "leveling"
  | "tickets"
  | "giveaways"
  | "starboard"
  | "economy"
  | "reminders"
  | "notifications"
  | "automation"
  | "music"
  | "analytics"
  | "polls"
  | "reputation"
  | "birthdays"
  | "invite-tracking";

export type ServerModuleConfig = {
  key: ServerModuleKey;
  enabled: boolean;
  settings: Record<string, unknown>;
};

export type ServerConfigExport = {
  schemaVersion: 1;
  exportedAt: string;
  guildId: string;
  modules: ServerModuleConfig[];
};
