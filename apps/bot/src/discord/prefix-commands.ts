import type { Message } from "discord.js";
import type { Database } from "../database.js";
import type { Leveling } from "../modules/leveling.js";
import type { Moderation } from "../modules/moderation.js";
import type { Music } from "../modules/music.js";
import type { CustomCommandService } from "../custom-commands.js";
import type { CommandPolicyService } from "../command-policy.js";
import type { Economy } from "../modules/economy.js";
import type { Reminders } from "../modules/reminders.js";
import type { Tickets } from "../modules/tickets.js";
import type { RolePanels } from "../modules/role-panels.js";
import type { Giveaways } from "../modules/giveaways.js";
import type { Utility } from "../modules/utility.js";
import type { CommunityTools } from "../modules/community-tools.js";
import type { Logging } from "../modules/logging.js";
import type { Welcome } from "../modules/welcome.js";
import type { Verification } from "../modules/verification.js";
import type { Security } from "../modules/security.js";
import type { AutoMod } from "../modules/automod.js";
import type { Starboard } from "../modules/starboard.js";
import type { Notifications } from "../modules/notifications.js";
import type { AutomationEngine } from "../modules/automation-engine.js";

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
    private readonly leveling: Leveling,
    private readonly moderation: Moderation,
    private readonly music: Music,
    private readonly customCommands: CustomCommandService,
    private readonly commandPolicy: CommandPolicyService,
    private readonly economy: Economy,
    private readonly reminders: Reminders,
    private readonly utility: Utility,
    private readonly communityTools: CommunityTools,
    private readonly logging: Logging,
    private readonly welcome: Welcome,
    private readonly verification: Verification,
    private readonly security: Security,
    private readonly autoMod: AutoMod,
    private readonly starboard: Starboard,
    private readonly notifications: Notifications,
    private readonly automation: AutomationEngine,
    private readonly tickets: Tickets,
    private readonly rolePanels: RolePanels,
    private readonly giveaways: Giveaways
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
        if (!await this.commandPolicy.checkMessage(message, commandName)) return;
        if (await this.leveling.handlePrefixCommand(message, commandName, args)) return;
        if (await this.music.handlePrefixCommand(message, commandName, args)) return;
        if (await this.economy.handlePrefixCommand(message, commandName, args)) return;
        if (await this.reminders.handlePrefixCommand(message, commandName, args)) return;
        if (await this.utility.handlePrefixCommand(message, commandName, args)) return;
        if (await this.communityTools.handlePrefixCommand(message, commandName, args)) return;
        if (await this.logging.handlePrefixCommand(message, commandName, args)) return;
        if (await this.welcome.handlePrefixCommand(message, commandName, args)) return;
        if (await this.verification.handlePrefixCommand(message, commandName, args)) return;
        if (await this.security.handlePrefixCommand(message, commandName, args)) return;
        if (await this.autoMod.handlePrefixCommand(message, commandName, args)) return;
        if (await this.starboard.handlePrefixCommand(message, commandName, args)) return;
        if (await this.notifications.handlePrefixCommand(message, commandName, args)) return;
        if (await this.automation.handlePrefixCommand(message, commandName, args)) return;
        if (await this.tickets.handlePrefixCommand(message, commandName)) return;
        if (await this.rolePanels.handlePrefixCommand(message, commandName, args)) return;
        if (await this.giveaways.handlePrefixCommand(message, commandName, args)) return;

        if (commandName === "history") {
          const target = message.mentions.users.first() ?? message.author;
          const cases = await this.moderation.history(message.guild.id, target.id, 10);
          const lines = cases.map((item) => "#" + item.id + " · " + item.action + " · " + (item.reason ?? "Без причины"));
          await message.reply(
            lines.length
              ? "📋 Moderation history for <@" + target.id + ">\n" + lines.join("\n")
              : "История модерации пуста."
          );
          return;
        }

        if (["ban", "unban", "kick", "timeout", "warn"].includes(commandName)) {
          await this.handleModeration(message, commandName, args);
          return;
        }

        if (commandName === "clear") {
          const amount = Number(args[0] ?? "");
          await this.moderation.purgeFromMessage(message, amount);
          return;
        }
        if (commandName === "slowmode") {
          const seconds = Number(args[0] ?? "");
          await this.moderation.slowmodeFromMessage(message, seconds);
          return;
        }
        if (commandName === "lock") {
          await this.moderation.lockChannelFromMessage(message);
          return;
        }
        if (commandName === "unlock") {
          await this.moderation.unlockChannelFromMessage(message);
          return;
        }
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

        if (await this.leveling.handlePrefixCommand(message, target, args)) return;
        if (await this.music.handlePrefixCommand(message, target, args)) return;
        if (await this.economy.handlePrefixCommand(message, target, args)) return;
        if (await this.reminders.handlePrefixCommand(message, target, args)) return;
        if (await this.utility.handlePrefixCommand(message, target, args)) return;
        if (await this.communityTools.handlePrefixCommand(message, target, args)) return;
        if (await this.logging.handlePrefixCommand(message, target, args)) return;
        if (await this.welcome.handlePrefixCommand(message, target, args)) return;
        if (await this.verification.handlePrefixCommand(message, target, args)) return;
        if (await this.security.handlePrefixCommand(message, target, args)) return;
        if (await this.autoMod.handlePrefixCommand(message, target, args)) return;
        if (await this.starboard.handlePrefixCommand(message, target, args)) return;
        if (await this.notifications.handlePrefixCommand(message, target, args)) return;
        if (await this.automation.handlePrefixCommand(message, target, args)) return;
        if (await this.tickets.handlePrefixCommand(message, target)) return;
        if (await this.rolePanels.handlePrefixCommand(message, target, args)) return;
        if (await this.giveaways.handlePrefixCommand(message, target, args)) return;

        if (["ban", "unban", "kick", "timeout", "warn"].includes(target)) {
          await this.handleModeration(message, target, args);
          return;
        }

        await message.reply("Неизвестная целевая команда alias: " + target);
        return;
      }

      await this.customCommands.handlePrefixCommand(message, custom, args);;
    } finally {
      this.busyGuilds.delete(message.guild.id);
    }
  }

  private async handleModeration(message: Message, commandName: string, args: string[]): Promise<void> {
    const targetId = this.extractUserId(message, args);
    if (!targetId) {
      await message.reply("Укажи пользователя: @user или ID.");
      return;
    }

    if (commandName === "unban") {
      const reason = this.remainingArgs(args, targetId).join(" ").trim() || "Без причины";
      await this.moderation.unbanFromMessage(message, targetId, reason);
      return;
    }

    const member = await message.guild!.members.fetch(targetId).catch(() => null);
    if (!member) {
      await message.reply("Пользователь не найден среди участников сервера.");
      return;
    }

    if (commandName === "warn" || commandName === "kick") {
      const reason = this.stripFlags(this.remainingArgs(args, targetId)).join(" ").trim() || "Без причины";
      if (commandName === "warn") {
        await this.moderation.warnFromMessage(message, member.user, reason);
      } else {
        await this.moderation.kickFromMessage(message, member, reason);
      }
      return;
    }

    const rawDuration = this.extractDuration(args)
      ?? (commandName === "timeout" ? this.firstPositionalDuration(args, targetId) : null);
    const durationProvided = Boolean(rawDuration);
    const durationMinutes = durationProvided ? parseDurationMinutes(rawDuration!) : null;

    if (commandName === "timeout" && durationMinutes === null) {
      await message.reply("Укажи срок timeout: 10m, 2h или 7d.");
      return;
    }
    if (commandName === "ban" && (durationProvided && durationMinutes === null)) {
      await message.reply("Некорректный срок бана. Пример: -t 10m, -t 2h или -t 7d.");
      return;
    }

    const reason = this.stripFlags(this.removeDurationTokens(this.remainingArgs(args, targetId))).join(" ").trim() || "Без причины";
    if (commandName === "timeout") {
      if (durationMinutes === null) throw new Error("timeout_duration_required");
      await this.moderation.timeoutFromMessage(message, member, durationMinutes, reason);
    } else {
      await this.moderation.banFromMessage(message, member, reason, durationMinutes ?? undefined);
    }
  }

  private extractUserId(message: Message, args: string[]): string | null {
    const mentioned = message.mentions.users.first();
    if (mentioned) return mentioned.id;
    const candidate = args.find((token) => /^\d{15,25}$/.test(token));
    return candidate ?? null;
  }

  private remainingArgs(args: string[], userId: string): string[] {
    const mentionIndex = args.findIndex((token) => token.includes(userId));
    if (mentionIndex >= 0) return args.slice(mentionIndex + 1);
    return args.filter((token) => token !== userId);
  }

  private extractDuration(args: string[]): string | null {
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i]!.toLowerCase();
      if (token === "-t" || token === "--time") return args[i + 1] ?? null;
      if (token.startsWith("-t=") || token.startsWith("--time=")) return token.split("=", 2)[1] ?? null;
    }
    return null;
  }

  private firstPositionalDuration(args: string[], userId: string): string | null {
    const rest = this.remainingArgs(args, userId);
    return rest.find((token) => /^\d+\s*(m|min|h|d|w)$/i.test(token)) ?? null;
  }

  private removeDurationTokens(args: string[]): string[] {
    const output: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i]!.toLowerCase();
      if (token === "-t" || token === "--time") {
        i += 1;
        continue;
      }
      if (token.startsWith("-t=") || token.startsWith("--time=")) continue;
      if (/^\d+\s*(m|min|h|d|w)$/i.test(token)) continue;
      output.push(args[i]!);
    }
    return output;
  }

  private stripFlags(args: string[]): string[] {
    return args.filter((token) => !token.startsWith("--") && token !== "-t");
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
