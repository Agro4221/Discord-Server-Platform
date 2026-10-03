export type ModuleKey =
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
  | "stream-alerts"
  | "automation"
  | "music"
  | "analytics"
  | "polls";

export const MODULE_CATALOG: readonly {
  key: ModuleKey;
  title: string;
  description: string;
  defaultEnabled: boolean;
}[] = [
  { key: "moderation", title: "Moderation", description: "Warnings and moderation actions", defaultEnabled: true },
  { key: "automod", title: "AutoMod", description: "Automated content and anti-spam controls", defaultEnabled: false },
  { key: "security", title: "Security", description: "Anti-raid, lockdown and anti-nuke controls", defaultEnabled: false },
  { key: "temporary-voice", title: "Temporary Voice", description: "Temporary voice rooms", defaultEnabled: false },
  { key: "welcome", title: "Welcome", description: "Welcome and goodbye messages", defaultEnabled: false },
  { key: "verification", title: "Verification", description: "Member verification and verified role", defaultEnabled: false },
  { key: "roles", title: "Roles", description: "Role panels and self-assignment", defaultEnabled: false },
  { key: "leveling", title: "Leveling", description: "XP, ranks and leaderboards", defaultEnabled: false },
  { key: "tickets", title: "Tickets", description: "Support tickets and transcripts", defaultEnabled: false },
  { key: "giveaways", title: "Giveaways", description: "Giveaway campaigns", defaultEnabled: false },
  { key: "starboard", title: "Starboard", description: "Community starboard", defaultEnabled: false },
  { key: "economy", title: "Economy", description: "Server economy and shop", defaultEnabled: false },
  { key: "reminders", title: "Reminders", description: "Reminders, AFK and utilities", defaultEnabled: false },
  { key: "notifications", title: "Notifications", description: "External feed notifications", defaultEnabled: false },
  { key: "stream-alerts", title: "Stream Alerts", description: "Twitch, YouTube and VK Video Live start notifications", defaultEnabled: false },
  { key: "automation", title: "Automation", description: "Event / condition / action workflows", defaultEnabled: false },
  { key: "music", title: "Music", description: "Lavalink music platform", defaultEnabled: false },
  { key: "analytics", title: "Analytics", description: "Server and module analytics", defaultEnabled: false },
  { key: "polls", title: "Polls & Suggestions", description: "Interactive polls and community suggestions", defaultEnabled: false }
];
