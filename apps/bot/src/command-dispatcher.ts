import type { Client, ChatInputCommandInteraction } from "discord.js";
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

    const handled =
      await this.leveling.executeSlashCommand(interaction, target) ||
      await this.economy.executeSlashCommand(interaction, target) ||
      await this.reminders.executeSlashCommand(interaction, target) ||
      await this.utility.executeSlashCommand(interaction, target) ||
      await this.communityTools.executeSlashCommand(interaction, target) ||
      await this.logging.executeSlashCommand(interaction, target) ||
      await this.welcome.executeSlashCommand(interaction, target) ||
      await this.verification.executeSlashCommand(interaction, target) ||
      await this.security.executeSlashCommand(interaction, target) ||
      await this.autoMod.executeSlashCommand(interaction, target) ||
      await this.starboard.executeSlashCommand(interaction, target) ||
      await this.notifications.executeSlashCommand(interaction, target) ||
      await this.automation.executeSlashCommand(interaction, target) ||
      await this.tickets.executeSlashCommand(interaction, target) ||
      await this.rolePanels.executeSlashCommand(interaction, target) ||
      await this.giveaways.executeSlashCommand(interaction, target) ||
      await this.music.executeSlashCommand(interaction, target) ||
      await this.analytics.executeSlashCommand(interaction, target);

    if (!handled && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Целевая команда alias пока недоступна.",
        ephemeral: true
      });
    }

    return handled;
  }

  private isCore(commandName: string): boolean {
    return new Set([
      "help","ping","clear","slowmode","lock","unlock",
      "ban","unban","kick","timeout","warn","setup","moderate"
    ]).has(commandName);
  }
}
