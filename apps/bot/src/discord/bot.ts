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

export async function registerCommands(config: AppConfig, client: Client): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = buildCommands().map((command) => command.toJSON());

  if (config.discordTestGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordTestGuildId),
      { body: commands }
    );
    logger.info("Registered test-guild commands", { guildId: config.discordTestGuildId, count: commands.length });
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands });
  logger.info("Registered global commands", { count: commands.length });
}

export function wireDiscordEvents(
  client: Client,
  db: Database,
  temporaryVoice: TemporaryVoice,
  setDiscordHealth: (status: "connecting" | "ready" | "down") => void
): void {
  client.once(Events.ClientReady, (readyClient) => {
    setDiscordHealth("ready");
    temporaryVoice.markReady();
    logger.info("Discord client ready", { user: readyClient.user.tag, guilds: readyClient.guilds.cache.size });
  });

  client.on(Events.Error, (error) => {
    setDiscordHealth("down");
    logger.error("Discord client error", { error: error.message });
  });

  client.on(Events.Warn, (message) => {
    logger.warn("Discord warning", { message });
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void temporaryVoice.handleVoiceState(oldState, newState).catch((error) => {
      logger.error("Temporary voice handler failed", {
        guildId: newState.guild.id,
        error: String(error)
      });
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void routeCommand(client, interaction, db, temporaryVoice);
  });
}

async function routeCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  db: Database,
  temporaryVoice: TemporaryVoice
): Promise<void> {
  try {
    await handleCommand(client, interaction, db, temporaryVoice);
  } catch (error) {
    logger.error("Command failed", {
      command: interaction.commandName,
      guildId: interaction.guildId,
      error: String(error)
    });

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "Произошла внутренняя ошибка.", ephemeral: true }).catch(() => undefined);
    } else {
      await interaction.reply({ content: "Произошла внутренняя ошибка.", ephemeral: true }).catch(() => undefined);
    }
  }
}
