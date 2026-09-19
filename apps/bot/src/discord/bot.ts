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
import type { PlatformEventBus } from "../events.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ]
  });
}

export async function registerCommands(
  config: AppConfig,
  _client: Client
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = buildCommands().map((command) => command.toJSON());

  if (config.discordTestGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordTestGuildId
      ),
      { body: commands }
    );
    logger.info("Registered test-guild commands", {
      guildId: config.discordTestGuildId,
      count: commands.length
    });
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: commands
  });
  logger.info("Registered global commands", { count: commands.length });
}

export function wireDiscordEvents(
  client: Client,
  events: PlatformEventBus
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void events.emit("interaction", interaction);
    if (interaction.isChatInputCommand()) {
      void events.emit("interaction.command", interaction);
    }
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void events.emit("voice.state", { oldState, newState });
  });

  client.on(Events.MessageCreate, (message) => {
    void events.emit("message.create", message);
  });

  client.on(Events.MessageDelete, (message) => {
    if (!message.partial) {
      void events.emit("message.delete", message);
    }
  });

  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    if (!oldMessage.partial && !newMessage.partial) {
      void events.emit("message.update", { oldMessage, newMessage });
    }
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void events.emit("reaction.add", { reaction, user });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    void events.emit("member.add", member);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    void events.emit("member.remove", member);
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    void events.emit("member.update", { oldMember, newMember });
  });

  client.on(Events.ChannelDelete, (channel) => {
    if (channel.guild) void events.emit("channel.delete", channel);
  });

  client.on(Events.RoleDelete, (role) => {
    void events.emit("role.delete", role);
  });
}

export async function routeCommand(
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

    const reply = {
      content: "Произошла внутренняя ошибка.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => undefined);
    } else {
      await interaction.reply(reply).catch(() => undefined);
    }
  }
}
