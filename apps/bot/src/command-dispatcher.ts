import type { Client, ChatInputCommandInteraction, Message } from "discord.js";
import type { Database } from "./database.js";
import type { TemporaryVoice } from "./modules/temporary-voice.js";
import type { Moderation } from "./modules/moderation.js";
import type { CommandPolicyService } from "./command-policy.js";
import { handleCommand } from "./discord/commands.js";
import type { Leveling } from "./modules/leveling.js";
import type { Economy } from "./modules/economy.js";
import type { Reminders } from "./modules/reminders.js";
import type { Utility } from "./modules/utility.js";
import type { CommunityTools } from "./modules/community-tools.js";
import type { Logging } from "./modules/logging.js";
import type { Welcome } from "./modules/welcome.js";
import type { Verification } from "./modules/verification.js";
import type { Security } from "./modules/security.js";
import type { AutoMod } from "./modules/automod.js";
import type { Starboard } from "./modules/starboard.js";
import type { Notifications } from "./modules/notifications.js";
import type { AutomationEngine } from "./modules/automation-engine.js";
import type { Tickets } from "./modules/tickets.js";
import type { RolePanels } from "./modules/role-panels.js";
import type { Giveaways } from "./modules/giveaways.js";
import type { Music } from "./modules/music.js";
import type { Analytics } from "./modules/analytics.js";

export class CommandDispatcher {
  constructor(
    private readonly client: Client,
    private readonly db: Database,
    private readonly temporaryVoice: TemporaryVoice,
    private readonly moderation: Moderation,
    private readonly commandPolicy: CommandPolicyService,
    private readonly leveling: Leveling,
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
    private readonly giveaways: Giveaways,
    private readonly music: Music,
    private readonly analytics: Analytics
  ) {}

  async executePrefix(message: Message, target: string, args: string[]): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;
    if (!await this.commandPolicy.checkMessage(message, target)) return true;

    if (["history","clear","slowmode","lock","unlock","ban","unban","kick","timeout","warn"].includes(target)) {
      if (target === "history") {
        const selected = message.mentions.users.first() ?? message.author;
        const cases = await this.moderation.history(message.guild.id, selected.id, 10);
        const lines = cases.map((item) => "#" + item.id + " · " + item.action + " · " + (item.reason ?? "Без причины"));
        await message.reply(lines.length
          ? "📋 Moderation history for <@" + selected.id + ">\n" + lines.join("\n")
          : "История модерации пуста.");
        return true;
      }
      if (["ban","unban","kick","timeout","warn"].includes(target)) {
        await this.handleModeration(message, target, args);
        return true;
      }
      if (target === "clear") {
        await this.moderation.purgeFromMessage(message, Number(args[0] ?? ""));
        return true;
      }
      if (target === "slowmode") {
        await this.moderation.slowmodeFromMessage(message, Number(args[0] ?? ""));
        return true;
      }
      if (target === "lock") {
        await this.moderation.lockChannelFromMessage(message);
        return true;
      }
      await this.moderation.unlockChannelFromMessage(message);
      return true;
    }

    const executor = this.prefixExecutorFor(target);
    if (!executor) return false;
    return executor(message, target, args);
  }

  private prefixExecutorFor(
    target: string
  ): ((message: Message, commandName: string, args: string[]) => Promise<boolean>) | null {
    if (["level","rank","top"].includes(target)) return (message, commandName, args) => this.leveling.handlePrefixCommand(message, commandName, args);
    if (["economy","shop","balance","daily","leaderboard","pay","buy"].includes(target)) return (message, commandName, args) => this.economy.handlePrefixCommand(message, commandName, args);
    if (target === "remind") return (message, commandName, args) => this.reminders.handlePrefixCommand(message, commandName, args);
    if (["serverinfo","userinfo","avatar","membercount","roleinfo","channelinfo","afk"].includes(target)) return (message, commandName, args) => this.utility.handlePrefixCommand(message, commandName, args);
    if (["poll","suggest","sticky","8ball","choose","roll"].includes(target)) return (message, commandName, args) => this.communityTools.handlePrefixCommand(message, commandName, args);
    if (target === "logging") return (message, commandName, args) => this.logging.handlePrefixCommand(message, commandName, args);
    if (target === "welcome") return (message, commandName, args) => this.welcome.handlePrefixCommand(message, commandName, args);
    if (target === "verify") return (message, commandName, args) => this.verification.handlePrefixCommand(message, commandName, args);
    if (target === "security") return (message, commandName, args) => this.security.handlePrefixCommand(message, commandName, args);
    if (target === "automod") return (message, commandName, args) => this.autoMod.handlePrefixCommand(message, commandName, args);
    if (target === "starboard") return (message, commandName, args) => this.starboard.handlePrefixCommand(message, commandName, args);
    if (target === "feed") return (message, commandName, args) => this.notifications.handlePrefixCommand(message, commandName, args);
    if (target === "automation") return (message, commandName, args) => this.automation.handlePrefixCommand(message, commandName, args);
    if (target === "ticket") return (message, commandName) => this.tickets.handlePrefixCommand(message, commandName);
    if (target === "roles") return (message, commandName, args) => this.rolePanels.handlePrefixCommand(message, commandName, args);
    if (target === "giveaway") return (message, commandName, args) => this.giveaways.handlePrefixCommand(message, commandName, args);
    if (["music","play","pause","resume","skip","stop","shuffle","playlist","queue","nowplaying","repeat","seek","volume","autoplay"].includes(target)) {
      return (message, commandName, args) => this.music.handlePrefixCommand(message, commandName, args);
    }
    return null;
  }

  async executeSlash(
    interaction: ChatInputCommandInteraction,
    target: string
  ): Promise<boolean> {
    if (!interaction.inGuild()) return false;

    if (!await this.commandPolicy.checkInteractionAs(interaction, target)) {
      return true;
    }

    if (this.isCore(target)) {
      await handleCommand(
        this.client,
        interaction,
        this.db,
        this.temporaryVoice,
        this.moderation,
        target
      );
      return true;
    }

    const executor = this.executorFor(target);
    if (!executor) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Целевая команда alias пока недоступна.",
          ephemeral: true
        });
      }
      return false;
    }

    await executor(interaction, target);
    return true;
  }

  private executorFor(
    target: string
  ): ((interaction: ChatInputCommandInteraction, commandName: string) => Promise<void>) | null {
    if (["level","rank","top"].includes(target)) return (interaction, commandName) => this.leveling.executeSlashCommand(interaction, commandName);
    if (["economy","shop","balance","daily","leaderboard","pay","buy"].includes(target)) return (interaction, commandName) => this.economy.executeSlashCommand(interaction, commandName);
    if (target === "remind") return (interaction, commandName) => this.reminders.executeSlashCommand(interaction, commandName);
    if (["serverinfo","userinfo","avatar","membercount","roleinfo","channelinfo","afk"].includes(target)) return (interaction, commandName) => this.utility.executeSlashCommand(interaction, commandName);
    if (["poll","suggest","sticky","8ball","choose","roll"].includes(target)) return (interaction, commandName) => this.communityTools.executeSlashCommand(interaction, commandName);
    if (target === "logging") return (interaction, commandName) => this.logging.executeSlashCommand(interaction, commandName);
    if (target === "welcome") return (interaction, commandName) => this.welcome.executeSlashCommand(interaction, commandName);
    if (target === "verify") return (interaction, commandName) => this.verification.executeSlashCommand(interaction, commandName);
    if (target === "security") return (interaction, commandName) => this.security.executeSlashCommand(interaction, commandName);
    if (target === "automod") return (interaction, commandName) => this.autoMod.executeSlashCommand(interaction, commandName);
    if (target === "starboard") return (interaction, commandName) => this.starboard.executeSlashCommand(interaction, commandName);
    if (target === "feed") return (interaction, commandName) => this.notifications.executeSlashCommand(interaction, commandName);
    if (target === "automation") return (interaction, commandName) => this.automation.executeSlashCommand(interaction, commandName);
    if (target === "ticket") return (interaction, commandName) => this.tickets.executeSlashCommand(interaction, commandName);
    if (target === "roles") return (interaction, commandName) => this.rolePanels.executeSlashCommand(interaction, commandName);
    if (target === "giveaway") return (interaction, commandName) => this.giveaways.executeSlashCommand(interaction, commandName);
    if (["music","play","pause","resume","skip","stop","shuffle","playlist","queue","nowplaying","repeat","seek","volume","autoplay"].includes(target)) {
      return (interaction, commandName) => this.music.executeSlashCommand(interaction, commandName);
    }
    if (target === "analytics") return (interaction, commandName) => this.analytics.executeSlashCommand(interaction, commandName);
    return null;
  }

  private async handleModeration(message: Message, commandName: string, args: string[]): Promise<void> {
    const targetId = message.mentions.users.first()?.id ?? args.find((token) => /^\d{15,25}$/.test(token));
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
      if (commandName === "warn") await this.moderation.warnFromMessage(message, member.user, reason);
      else await this.moderation.kickFromMessage(message, member, reason);
      return;
    }
    const rawDuration = this.extractDuration(args) ?? (commandName === "timeout" ? this.firstPositionalDuration(args, targetId) : null);
    const durationProvided = Boolean(rawDuration);
    const durationMinutes = durationProvided ? parseDurationMinutes(rawDuration!) : null;
    if (commandName === "timeout" && durationMinutes === null) {
      await message.reply("Укажи срок timeout: 10m, 2h или 7d.");
      return;
    }
    if (commandName === "ban" && durationProvided && durationMinutes === null) {
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
    return this.remainingArgs(args, userId).find((token) => /^\d+\s*(m|min|h|d|w)$/i.test(token)) ?? null;
  }

  private removeDurationTokens(args: string[]): string[] {
    const output: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i]!.toLowerCase();
      if (token === "-t" || token === "--time") { i += 1; continue; }
      if (token.startsWith("-t=") || token.startsWith("--time=")) continue;
      if (/^\d+\s*(m|min|h|d|w)$/i.test(token)) continue;
      output.push(args[i]!);
    }
    return output;
  }

  private stripFlags(args: string[]): string[] {
    return args.filter((token) => !token.startsWith("--") && token !== "-t");
  }

  private isCore(commandName: string): boolean {
    return new Set([
      "help","ping","clear","slowmode","lock","unlock",
      "ban","unban","kick","timeout","warn","setup","moderate"
    ]).has(commandName);
  }
}


function parseDurationMinutes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*(m|min|h|d|w)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const multiplier = unit === "w" ? 7 * 24 * 60 : unit === "d" ? 24 * 60 : unit === "h" ? 60 : 1;
  const minutes = amount * multiplier;
  return Number.isSafeInteger(minutes) && minutes <= 40320 ? minutes : null;
}
