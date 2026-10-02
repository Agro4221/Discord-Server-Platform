import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction
} from "discord.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../database.js";
import { logger } from "../logger.js";
import { buildCommands, handleCommand } from "./commands.js";
import { TemporaryVoice } from "../modules/temporary-voice.js";
import { Moderation } from "../modules/moderation.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });
}

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = buildCommands().map((command) => command.toJSON());

  if (config.discordTestGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordTestGuildId),
      { body: commands }
    );
    logger.info("Registered guild commands", { guildId: config.discordTestGuildId, count: commands.length });
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands });
  logger.info("Registered global commands", { count: commands.length });
}

export function wireDiscordEvents(
  client: Client,
  db: Database,
  temporaryVoice: TemporaryVoice,
  moderation: Moderation
): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void temporaryVoice.handleVoiceState(oldState, newState).catch((error) => {
      logger.error("Temporary voice handler failed", {
        guildId: newState.guild.id,
        userId: newState.id,
        error: String(error)
      });
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void routeCommand(client, interaction, db, temporaryVoice, moderation);
  });
}

async function routeCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  db: Database,
  temporaryVoice: TemporaryVoice,
  moderation: Moderation
): Promise<void> {
  try {
    await handleCommand(client, interaction, db, temporaryVoice, moderation);
  } catch (error) {
    logger.error("Command failed", {
      command: interaction.commandName,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      error: String(error)
    });

    const reply = { content: "Произошла внутренняя ошибка.", ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => undefined);
    else await interaction.reply(reply).catch(() => undefined);
  }
}
