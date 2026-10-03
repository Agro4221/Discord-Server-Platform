import type { Message } from "discord.js";
import type { Database } from "../database.js";
import type { CustomCommandService } from "../custom-commands.js";
import type { CommandPolicyService } from "../command-policy.js";
import type { CommandDispatcher } from "../command-dispatcher.js";


const BUILTIN_PREFIX_COMMANDS = new Set([
  "help",
  "level", "rank", "top",
  "ban", "unban", "kick", "timeout", "warn", "history", "clear", "slowmode", "lock", "unlock",
  "play", "pause", "resume", "skip", "stop", "shuffle",
  "playlist", "queue", "nowplaying", "repeat", "seek", "volume", "autoplay",
  "balance", "daily", "leaderboard", "pay", "shop", "buy", "remind", "ticket", "roles", "giveaway",
  "automod", "welcome", "security", "verify", "starboard", "feed", "automation",
  "serverinfo", "userinfo", "avatar", "membercount", "roleinfo", "channelinfo", "afk",
  "poll", "suggest", "sticky", "8ball", "choose", "roll", "logging"
]);

export class PrefixCommandRouter {
  private readonly busyGuilds = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly customCommands: CustomCommandService,
    private readonly commandPolicy: CommandPolicyService,
    private readonly dispatcher: CommandDispatcher
  ) {}

  async handleMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;

    const prefix = await this.getPrefix(message.guild.id);
    if (!message.content.startsWith(prefix)) return;

    const body = message.content.slice(prefix.length).trim();
    if (!body) return;

    const parts = body.split(/\s+/);
    const commandName = (parts.shift() ?? "").toLowerCase();
    const args = parts;

    const custom = BUILTIN_PREFIX_COMMANDS.has(commandName)
      ? null
      : await this.customCommands.findPrefix(message.guild.id, commandName);
    if (!BUILTIN_PREFIX_COMMANDS.has(commandName) && !custom) return;
    if (this.busyGuilds.has(message.guild.id)) return;

    this.busyGuilds.add(message.guild.id);
    try {
      if (commandName === "help") {
        const policies = await this.commandPolicy.list(message.guild.id);
        const builtIn = policies
          .filter((item) => item.enabled && item.prefixEnabled && item.helpVisible)
          .map((item) => prefix + item.commandName);
        const customRows = await this.db.query<{ name: string; description: string }>(
          "SELECT name,description FROM custom_commands WHERE guild_id=$1 AND enabled=true AND prefix_enabled=true ORDER BY name",
          [message.guild.id]
        );
        const custom = customRows.rows.map((row) => prefix + row.name + (row.description ? " — " + row.description : ""));
        await message.reply(
          ["**Vexa — команды**", builtIn.length ? builtIn.join(", ") : "Нет доступных prefix-команд.", custom.length ? "\n**Custom Commands**\n" + custom.join("\n") : ""]
            .filter(Boolean)
            .join("\n")
            .slice(0, 3900)
        );
        return;
      }

      if (BUILTIN_PREFIX_COMMANDS.has(commandName)) {
        if (await this.dispatcher.executePrefix(message, commandName, args)) return;
        return;
      }

      if (!custom) return;
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const allowed = await this.customCommands.canExecute(
        custom,
        message.guild.id,
        message.author.id,
        member?.roles.cache.map((role) => role.id) ?? [],
        message.channelId
      );
      if (!allowed) return;

      if (custom.actionType === "alias" && custom.aliasTarget) {
        const target = custom.aliasTarget;
        if (target === "help") {
          const policies = await this.commandPolicy.list(message.guild.id);
          const available = policies
            .filter((item) => item.enabled && item.prefixEnabled && item.helpVisible)
            .map((item) => prefix + item.commandName);
          await message.reply(
            available.length ? available.join(", ").slice(0, 3900) : "Нет доступных prefix-команд."
          );
          return;
        }

        if (await this.dispatcher.executePrefix(message, target, args)) return;
        await message.reply("Неизвестная или недоступная целевая команда alias: " + target);
        return;
      }

      await this.customCommands.handlePrefixCommand(message, custom, args);;
    } finally {
      this.busyGuilds.delete(message.guild.id);
    }
  }

  private async getPrefix(guildId: string): Promise<string> {
    const result = await this.db.query<{ command_prefix: string }>(
      "SELECT command_prefix FROM guild_settings WHERE guild_id=$1",
      [guildId]
    );
    return result.rows[0]?.command_prefix || "!";
  }
}

export function parseDurationMinutes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const multiplier = unit === "w" ? 7 * 24 * 60 : unit === "d" ? 24 * 60 : unit === "h" ? 60 : 1;
  const minutes = amount * multiplier;
  return Number.isSafeInteger(minutes) && minutes <= 40320 ? minutes : null;
}
